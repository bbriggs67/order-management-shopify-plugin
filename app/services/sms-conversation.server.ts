/**
 * SMS Conversation Service — two-way messaging via Twilio.
 *
 * Handles outbound (admin→customer) and inbound (customer→admin) SMS messages.
 * Messages are stored in the SmsMessage table and displayed as a conversation
 * thread on the CRM customer detail page.
 */

import prisma from "../db.server";
import { sendSMS } from "./notifications.server";
import { normalizePhone } from "../utils/phone.server";
import type { SmsMessageData } from "../types/customer-crm";

// ============================================
// GET CONVERSATION
// ============================================

/**
 * Fetch the conversation history for a customer.
 * Returns messages ordered oldest-first for natural chat display.
 */
export async function getConversation(
  customerId: string,
  limit: number = 50
): Promise<SmsMessageData[]> {
  const messages = await prisma.smsMessage.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return messages.map((m) => ({
    id: m.id,
    direction: m.direction as "INBOUND" | "OUTBOUND",
    body: m.body,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }));
}

// ============================================
// GET NEW MESSAGES (for polling)
// ============================================

/**
 * Fetch messages created after a given message ID.
 * Used by the polling mechanism to get only new messages.
 */
export async function getNewMessages(
  customerId: string,
  afterId: string
): Promise<SmsMessageData[]> {
  // Find the timestamp of the anchor message
  const anchor = await prisma.smsMessage.findUnique({
    where: { id: afterId },
    select: { createdAt: true },
  });

  if (!anchor) {
    // Anchor not found — return full conversation as fallback
    return getConversation(customerId, 50);
  }

  const messages = await prisma.smsMessage.findMany({
    where: {
      customerId,
      createdAt: { gt: anchor.createdAt },
    },
    orderBy: { createdAt: "asc" },
  });

  return messages.map((m) => ({
    id: m.id,
    direction: m.direction as "INBOUND" | "OUTBOUND",
    body: m.body,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }));
}

// ============================================
// SEND OUTBOUND SMS
// ============================================

/**
 * Send an SMS to a customer and record it in the conversation.
 * Creates a SmsMessage record regardless of success/failure.
 */
export async function sendAndRecordSMS(
  shop: string,
  customerId: string,
  phone: string,
  body: string
): Promise<{ success: boolean; message?: SmsMessageData; error?: string }> {
  // Safety truncation
  const truncatedBody = body.slice(0, 1600);
  const normalizedPhone = normalizePhone(phone) || phone;

  // Send via Twilio
  const result = await sendSMS(normalizedPhone, truncatedBody);

  // Record in DB regardless of outcome
  const record = await prisma.smsMessage.create({
    data: {
      shop,
      customerId,
      phone: normalizedPhone,
      direction: "OUTBOUND",
      body: truncatedBody,
      status: result.success ? "SENT" : "FAILED",
      twilioSid: result.twilioSid || null,
      errorMessage: result.error || null,
    },
  });

  return {
    success: result.success,
    message: {
      id: record.id,
      direction: "OUTBOUND",
      body: record.body,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
    },
    error: result.error,
  };
}

// ============================================
// RECORD INBOUND SMS (from Twilio webhook)
// ============================================

/**
 * Record an inbound SMS from a customer.
 * Called by the Twilio webhook handler.
 *
 * Looks up the customer by phone number, deduplicates by Twilio MessageSid.
 */
export async function recordInboundSMS(
  phone: string,
  body: string,
  twilioSid: string
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { success: false, error: "Invalid phone number" };
  }

  // Dedup: check if this MessageSid already exists
  if (twilioSid) {
    const existing = await prisma.smsMessage.findUnique({
      where: { twilioSid },
    });
    if (existing) {
      return { success: true, customerId: existing.customerId };
    }
  }

  // Look up customer by normalized phone (indexed for O(1) lookup)
  const match = await prisma.customer.findFirst({
    where: { phoneNormalized: normalized },
    select: { id: true, shop: true },
  });

  if (!match) {
    console.log(`Inbound SMS from unknown phone: ${normalized.slice(0, 6)}***`);
    return { success: false, error: "No matching customer found" };
  }

  await prisma.smsMessage.create({
    data: {
      shop: match.shop,
      customerId: match.id,
      phone: normalized,
      direction: "INBOUND",
      body: body.slice(0, 5000), // Safety truncation
      status: "RECEIVED",
      twilioSid: twilioSid || null,
    },
  });

  return { success: true, customerId: match.id };
}
