/**
 * Twilio Inbound SMS Webhook
 *
 * Receives POST from Twilio when a customer sends a text to our Twilio number.
 * This is NOT a Shopify webhook — uses Twilio signature validation instead.
 *
 * Twilio webhook URL to configure:
 *   https://order-management-shopify-plugin-production.up.railway.app/api/twilio-webhook
 *
 * Twilio sends form-urlencoded POST with fields:
 *   From, To, Body, MessageSid, AccountSid, NumMedia, etc.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { validateTwilioSignature } from "../utils/twilio-signature.server";
import { recordInboundSMS } from "../services/sms-conversation.server";
import { checkRateLimit } from "../utils/rate-limiter.server";

// Rate limit: 60 requests per minute per IP (generous for legitimate Twilio traffic)
const WEBHOOK_RATE_LIMIT = {
  maxRequests: 60,
  windowMs: 60 * 1000,
};

// ============================================
// POST — Receive inbound SMS from Twilio
// ============================================

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Rate limit by source IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rateResult = checkRateLimit(`twilio-webhook:${ip}`, WEBHOOK_RATE_LIMIT);
  if (!rateResult.allowed) {
    return new Response("Too many requests", { status: 429 });
  }

  // Parse form-encoded body (Twilio sends application/x-www-form-urlencoded)
  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = String(value);
  }

  // Validate Twilio signature
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("X-Twilio-Signature") || "";

  if (!authToken) {
    console.error("Twilio webhook received but TWILIO_AUTH_TOKEN not configured");
    // Return 200 to prevent Twilio retries
    return twimlResponse();
  }

  // Build the URL Twilio used for signing.
  // Use TWILIO_WEBHOOK_URL if set (in case SHOPIFY_APP_URL differs from Railway URL),
  // otherwise construct from SHOPIFY_APP_URL.
  const webhookUrl =
    process.env.TWILIO_WEBHOOK_URL ||
    `${process.env.SHOPIFY_APP_URL}/api/twilio-webhook`;

  const isValid = validateTwilioSignature(authToken, signature, webhookUrl, params);
  if (!isValid) {
    console.error("Invalid Twilio signature on inbound webhook");
    return new Response("Forbidden", { status: 403 });
  }

  // Extract message fields
  const from = params.From || "";
  const body = params.Body || "";
  const messageSid = params.MessageSid || "";

  if (!from || !messageSid) {
    console.error("Missing required fields in Twilio webhook:", {
      from: !!from,
      body: !!body,
      messageSid: !!messageSid,
    });
    // Return 200 to prevent retries on malformed requests
    return twimlResponse();
  }

  // Record the inbound message
  try {
    const result = await recordInboundSMS(from, body, messageSid);
    if (!result.success) {
      // Not a fatal error — customer may not be in CRM yet
      console.log(`Inbound SMS not matched: ${result.error} (from: ${from.slice(0, 6)}***)`);
    } else {
      console.log(`Inbound SMS recorded for customer ${result.customerId}`);
    }
  } catch (error) {
    console.error("Error recording inbound SMS:", error);
    // Still return 200 to prevent Twilio retry loops
    // Dedup by twilioSid will catch any reprocessing
  }

  // Return empty TwiML response (no auto-reply)
  return twimlResponse();
};

// ============================================
// GET — Endpoint info (for debugging)
// ============================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json(
    {
      endpoint: "/api/twilio-webhook",
      method: "POST",
      description: "Twilio inbound SMS webhook. Configure in Twilio console.",
      status: process.env.TWILIO_AUTH_TOKEN ? "configured" : "not_configured",
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
};

// ============================================
// TwiML Response Helper
// ============================================

/**
 * Return a TwiML XML response.
 * Empty <Response/> tells Twilio "message received, don't auto-reply."
 * Optionally include a <Message> to auto-reply.
 */
function twimlResponse(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
