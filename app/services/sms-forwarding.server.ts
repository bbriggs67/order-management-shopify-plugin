/**
 * SMS Forwarding Service
 *
 * Forwards inbound customer SMS messages to a configured admin phone number.
 * Settings are per-shop, stored in NotificationSettings.
 *
 * Called fire-and-forget from the Twilio webhook handler — must never throw.
 */

import prisma from "../db.server";
import { sendSMS } from "./notifications.server";
import { normalizePhone } from "../utils/phone.server";

/**
 * Forward an inbound customer SMS to the admin's configured forwarding number.
 * No-op if forwarding is disabled or not configured for the shop.
 */
export async function forwardInboundSMS(
  shop: string,
  customerName: string,
  messageBody: string
): Promise<{ forwarded: boolean; error?: string }> {
  try {
    // Look up forwarding settings for this shop
    const settings = await prisma.notificationSettings.findUnique({
      where: { shop },
      select: { smsForwardingEnabled: true, smsForwardingPhone: true },
    });

    if (!settings?.smsForwardingEnabled || !settings?.smsForwardingPhone) {
      return { forwarded: false };
    }

    // Validate the forwarding phone is in E.164 format
    const forwardTo = normalizePhone(settings.smsForwardingPhone);
    if (!forwardTo) {
      console.error(`Invalid forwarding phone for shop ${shop}: ${settings.smsForwardingPhone}`);
      return { forwarded: false, error: "Invalid forwarding phone number" };
    }

    // Format the forwarded message — truncate body to leave room for prefix
    const truncatedBody = messageBody.slice(0, 1400);
    const forwardMessage = `[SSMA] New text from ${customerName}:\n\n${truncatedBody}`;

    // Send via existing sendSMS function
    const result = await sendSMS(forwardTo, forwardMessage);

    if (!result.success) {
      console.error(`SMS forwarding failed for shop ${shop}: ${result.error}`);
      return { forwarded: false, error: result.error };
    }

    console.log(`SMS forwarded to ${forwardTo.slice(0, 6)}*** for shop ${shop}`);
    return { forwarded: true };
  } catch (error) {
    console.error("SMS forwarding unexpected error:", error);
    return { forwarded: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
