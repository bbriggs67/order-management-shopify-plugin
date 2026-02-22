/**
 * Customer Subscriptions JSON API
 *
 * Used by the Customer Account UI Extensions to manage subscriptions.
 * Authentication: Shopify session token JWT in Authorization header.
 *
 * GET  /api/customer-subscriptions — List subscriptions + available options
 * POST /api/customer-subscriptions — Perform actions (pause, resume, cancel, reschedule)
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  verifyCustomerSessionToken,
  type VerifiedSession,
} from "../utils/session-token.server";
import {
  getCustomerSubscriptions,
  customerPauseSubscription,
  customerResumeSubscription,
  customerCancelSubscription,
  customerOneTimeReschedule,
  customerClearOneTimeReschedule,
  customerPermanentReschedule,
  getAvailablePickupDays,
  getAvailableTimeSlots,
} from "../services/customer-subscription.server";
import { unauthenticated } from "../shopify.server";
import { checkRateLimit, RATE_LIMITS } from "../utils/rate-limiter.server";

// ============================================
// CORS headers for cross-origin extension requests
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ============================================
// Customer email cache (GID → email)
// Avoids repeated GraphQL calls during a session
// ============================================

const customerEmailCache = new Map<
  string,
  { email: string; expiresAt: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 500; // Prevent unbounded memory growth

async function resolveCustomerEmail(
  shop: string,
  customerGid: string
): Promise<string | null> {
  const cacheKey = `${shop}:${customerGid}`;
  const cached = customerEmailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.email;
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `
      query getCustomerEmail($id: ID!) {
        customer(id: $id) {
          email
        }
      }
    `,
      { variables: { id: customerGid } }
    );

    const data = await response.json();
    const email = data?.data?.customer?.email;

    if (email) {
      // Evict expired entries if cache is at max size
      if (customerEmailCache.size >= CACHE_MAX_SIZE) {
        const now = Date.now();
        for (const [key, val] of customerEmailCache) {
          if (val.expiresAt < now) customerEmailCache.delete(key);
        }
        // If still at max after eviction, delete oldest entry
        if (customerEmailCache.size >= CACHE_MAX_SIZE) {
          const firstKey = customerEmailCache.keys().next().value;
          if (firstKey) customerEmailCache.delete(firstKey);
        }
      }
      customerEmailCache.set(cacheKey, {
        email: email.toLowerCase().trim(),
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return email.toLowerCase().trim();
    }

    console.error(
      `Could not resolve email for customer ${customerGid} on shop ${shop}`
    );
    return null;
  } catch (error) {
    console.error(
      `Error resolving customer email for ${customerGid}:`,
      error
    );
    return null;
  }
}

// ============================================
// Authentication helper
// ============================================

function authenticateRequest(
  request: Request
): VerifiedSession {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }

  const token = authHeader.replace("Bearer ", "");
  return verifyCustomerSessionToken(token);
}

// ============================================
// OPTIONS — CORS preflight
// ============================================

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // POST handler
  if (request.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    // Authenticate
    const session = authenticateRequest(request);
    const customerEmail = await resolveCustomerEmail(
      session.shop,
      session.customerGid
    );

    if (!customerEmail) {
      return json(
        { success: false, message: "Could not identify customer" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Rate limit
    const rateLimitKey = `customer-api:${session.shop}:${customerEmail}`;
    const rateCheck = checkRateLimit(rateLimitKey, RATE_LIMITS.FORM_SUBMISSION);
    if (!rateCheck.allowed) {
      return json(
        {
          success: false,
          message: "Too many requests. Please wait a moment and try again.",
        },
        { status: 429, headers: corsHeaders }
      );
    }

    // Parse body and sanitize text inputs
    const body = await request.json();
    const sanitizeText = (val: unknown): string | undefined =>
      typeof val === "string" ? val.slice(0, 500).trim() : undefined;
    const {
      action: actionType,
      subscriptionId,
      newPickupDate,
      newTimeSlot,
      newPreferredDay,
    } = body;
    const comment = sanitizeText(body.comment);
    const reason = sanitizeText(body.reason);

    if (!actionType || !subscriptionId) {
      return json(
        { success: false, message: "Missing action or subscriptionId" },
        { status: 400, headers: corsHeaders }
      );
    }

    let result;

    switch (actionType) {
      case "pause":
        result = await customerPauseSubscription(
          session.shop,
          subscriptionId,
          customerEmail,
          comment
        );
        break;

      case "resume":
        result = await customerResumeSubscription(
          session.shop,
          subscriptionId,
          customerEmail,
          comment
        );
        break;

      case "cancel":
        result = await customerCancelSubscription(
          session.shop,
          subscriptionId,
          customerEmail,
          comment
        );
        break;

      case "oneTimeReschedule":
        if (!newPickupDate || !newTimeSlot) {
          return json(
            {
              success: false,
              message: "Missing newPickupDate or newTimeSlot",
            },
            { status: 400, headers: corsHeaders }
          );
        }
        // Ensure date string has time component to avoid UTC midnight → wrong day in Pacific
        const safeDateStr = newPickupDate.includes("T")
          ? newPickupDate
          : `${newPickupDate}T12:00:00`;
        const parsedDate = new Date(safeDateStr);
        if (isNaN(parsedDate.getTime())) {
          return json(
            { success: false, message: "Invalid pickup date format" },
            { status: 400, headers: corsHeaders }
          );
        }
        result = await customerOneTimeReschedule(
          session.shop,
          subscriptionId,
          customerEmail,
          parsedDate,
          newTimeSlot,
          reason
        );
        break;

      case "clearReschedule":
        result = await customerClearOneTimeReschedule(
          session.shop,
          subscriptionId,
          customerEmail
        );
        break;

      case "permanentReschedule":
        if (newPreferredDay === undefined || !newTimeSlot) {
          return json(
            {
              success: false,
              message: "Missing newPreferredDay or newTimeSlot",
            },
            { status: 400, headers: corsHeaders }
          );
        }
        const parsedDay = parseInt(newPreferredDay, 10);
        if (isNaN(parsedDay) || parsedDay < 0 || parsedDay > 6) {
          return json(
            { success: false, message: "Invalid preferred day (must be 0-6)" },
            { status: 400, headers: corsHeaders }
          );
        }
        result = await customerPermanentReschedule(
          session.shop,
          subscriptionId,
          customerEmail,
          parsedDay,
          newTimeSlot,
          reason
        );
        break;

      default:
        return json(
          { success: false, message: `Unknown action: ${actionType}` },
          { status: 400, headers: corsHeaders }
        );
    }

    return json(result, { headers: corsHeaders });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authentication failed";
    console.error("Customer subscription API error:", error);
    // Distinguish auth errors (JWT/token) from server errors
    const isAuthError =
      error instanceof Error &&
      (error.message.includes("JWT") ||
        error.message.includes("token") ||
        error.message.includes("Authentication") ||
        error.message.includes("customer"));
    return json(
      { success: false, message },
      { status: isAuthError ? 401 : 500, headers: corsHeaders }
    );
  }
};

// ============================================
// GET — List subscriptions + options
// ============================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Authenticate
    const session = authenticateRequest(request);
    const customerEmail = await resolveCustomerEmail(
      session.shop,
      session.customerGid
    );

    if (!customerEmail) {
      return json(
        { error: "Could not identify customer" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Rate limit
    const rateLimitKey = `customer-api-read:${session.shop}:${customerEmail}`;
    const rateCheck = checkRateLimit(rateLimitKey, RATE_LIMITS.CUSTOMER_PORTAL);
    if (!rateCheck.allowed) {
      return json(
        { error: "Too many requests" },
        { status: 429, headers: corsHeaders }
      );
    }

    // Fetch data
    const [subscriptions, availableDays, availableTimeSlots] =
      await Promise.all([
        getCustomerSubscriptions(session.shop, customerEmail),
        getAvailablePickupDays(session.shop),
        getAvailableTimeSlots(session.shop),
      ]);

    return json(
      {
        subscriptions,
        availableDays,
        availableTimeSlots,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authentication failed";
    console.error("Customer subscription API error:", error);
    const isAuthError =
      error instanceof Error &&
      (error.message.includes("JWT") ||
        error.message.includes("token") ||
        error.message.includes("Authentication") ||
        error.message.includes("customer"));
    return json(
      { error: message },
      { status: isAuthError ? 401 : 500, headers: corsHeaders }
    );
  }
};
