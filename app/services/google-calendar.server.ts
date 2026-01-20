/**
 * Google Calendar Integration Service
 * Handles OAuth flow and calendar event management
 */

import prisma from "../db.server";
import { SHOP_TIMEZONE } from "../utils/timezone.server";

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";

// Google API endpoints
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// Scopes needed for calendar access
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

interface CalendarEvent {
  id?: string;
  summary: string;
  description: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: string;
  colorId?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * Check if Google Calendar is configured
 */
export function isGoogleCalendarConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

/**
 * Generate OAuth authorization URL
 */
export function getGoogleAuthUrl(shop: string): string {
  if (!isGoogleCalendarConfigured()) {
    throw new Error("Google Calendar is not configured");
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: shop, // Pass shop as state for callback
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: GOOGLE_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${error}`);
  }

  return response.json();
}

/**
 * Refresh access token
 */
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh token: ${error}`);
  }

  return response.json();
}

/**
 * Get valid access token (refreshing if needed)
 */
async function getValidAccessToken(shop: string): Promise<string | null> {
  const auth = await prisma.googleCalendarAuth.findUnique({
    where: { shop },
  });

  if (!auth) {
    return null;
  }

  // Check if token is expired (with 5 minute buffer)
  const now = new Date();
  const expiresAt = new Date(auth.expiresAt);
  const bufferMs = 5 * 60 * 1000;

  if (now.getTime() > expiresAt.getTime() - bufferMs) {
    // Token is expired or about to expire, refresh it
    try {
      const tokens = await refreshAccessToken(auth.refreshToken);
      const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await prisma.googleCalendarAuth.update({
        where: { shop },
        data: {
          accessToken: tokens.access_token,
          expiresAt: newExpiresAt,
          // Only update refresh token if a new one was provided
          ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        },
      });

      return tokens.access_token;
    } catch (error) {
      console.error("Failed to refresh Google token:", error);
      return null;
    }
  }

  return auth.accessToken;
}

/**
 * Save OAuth tokens for a shop
 */
export async function saveGoogleAuth(
  shop: string,
  tokens: TokenResponse
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.googleCalendarAuth.upsert({
    where: { shop },
    create: {
      shop,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt,
      calendarId: "primary",
    },
    update: {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
      expiresAt,
    },
  });
}

/**
 * Check if shop has Google Calendar connected
 */
export async function isGoogleCalendarConnected(shop: string): Promise<boolean> {
  const auth = await prisma.googleCalendarAuth.findUnique({
    where: { shop },
  });
  return !!auth;
}

/**
 * Create a calendar event for a pickup
 */
export async function createPickupEvent(
  shop: string,
  pickupScheduleId: string
): Promise<string | null> {
  const accessToken = await getValidAccessToken(shop);
  if (!accessToken) {
    console.log("No valid Google token for shop:", shop);
    return null;
  }

  const auth = await prisma.googleCalendarAuth.findUnique({
    where: { shop },
  });

  const pickup = await prisma.pickupSchedule.findUnique({
    where: { id: pickupScheduleId },
    include: { pickupLocation: true, orderItems: true },
  });

  if (!pickup || !auth) {
    return null;
  }

  // Parse time slot (e.g., "12:00 PM - 2:00 PM")
  const { startTime, endTime } = parseTimeSlot(pickup.pickupTimeSlot);

  // Create start and end times
  const pickupDate = new Date(pickup.pickupDate);
  const startDateTime = new Date(pickupDate);
  startDateTime.setHours(startTime.hour, startTime.minute, 0, 0);

  const endDateTime = new Date(pickupDate);
  endDateTime.setHours(endTime.hour, endTime.minute, 0, 0);

  // Build event description
  const items = pickup.orderItems
    .map((item) => `- ${item.productTitle} x${item.quantity}`)
    .join("\n");

  const event: CalendarEvent = {
    summary: `Pickup: ${pickup.shopifyOrderNumber} - ${pickup.customerName}`,
    description: `Order: ${pickup.shopifyOrderNumber}
Customer: ${pickup.customerName}
${pickup.customerPhone ? `Phone: ${pickup.customerPhone}` : ""}
${pickup.customerEmail ? `Email: ${pickup.customerEmail}` : ""}

Items:
${items}

Status: ${pickup.pickupStatus}`,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: SHOP_TIMEZONE,
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: SHOP_TIMEZONE,
    },
    location: pickup.pickupLocation
      ? `${pickup.pickupLocation.name} - ${pickup.pickupLocation.address}`
      : undefined,
    colorId: getStatusColor(pickup.pickupStatus),
  };

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(auth.calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to create calendar event:", error);
      return null;
    }

    const createdEvent = await response.json();

    // Save the event ID to the pickup schedule
    await prisma.pickupSchedule.update({
      where: { id: pickupScheduleId },
      data: { googleEventId: createdEvent.id },
    });

    return createdEvent.id;
  } catch (error) {
    console.error("Error creating calendar event:", error);
    return null;
  }
}

/**
 * Update a calendar event when pickup status changes
 */
export async function updatePickupEvent(
  shop: string,
  pickupScheduleId: string
): Promise<boolean> {
  const pickup = await prisma.pickupSchedule.findUnique({
    where: { id: pickupScheduleId },
    include: { pickupLocation: true, orderItems: true },
  });

  if (!pickup || !pickup.googleEventId) {
    return false;
  }

  const accessToken = await getValidAccessToken(shop);
  if (!accessToken) {
    return false;
  }

  const auth = await prisma.googleCalendarAuth.findUnique({
    where: { shop },
  });

  if (!auth) {
    return false;
  }

  // Build updated description
  const items = pickup.orderItems
    .map((item) => `- ${item.productTitle} x${item.quantity}`)
    .join("\n");

  const updates = {
    summary: `Pickup: ${pickup.shopifyOrderNumber} - ${pickup.customerName}`,
    description: `Order: ${pickup.shopifyOrderNumber}
Customer: ${pickup.customerName}
${pickup.customerPhone ? `Phone: ${pickup.customerPhone}` : ""}
${pickup.customerEmail ? `Email: ${pickup.customerEmail}` : ""}

Items:
${items}

Status: ${pickup.pickupStatus}`,
    colorId: getStatusColor(pickup.pickupStatus),
  };

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(auth.calendarId)}/events/${pickup.googleEventId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      }
    );

    return response.ok;
  } catch (error) {
    console.error("Error updating calendar event:", error);
    return false;
  }
}

/**
 * Delete a calendar event when pickup is cancelled
 */
export async function deletePickupEvent(
  shop: string,
  pickupScheduleId: string
): Promise<boolean> {
  const pickup = await prisma.pickupSchedule.findUnique({
    where: { id: pickupScheduleId },
  });

  if (!pickup || !pickup.googleEventId) {
    return false;
  }

  const accessToken = await getValidAccessToken(shop);
  if (!accessToken) {
    return false;
  }

  const auth = await prisma.googleCalendarAuth.findUnique({
    where: { shop },
  });

  if (!auth) {
    return false;
  }

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(auth.calendarId)}/events/${pickup.googleEventId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.ok || response.status === 404) {
      // Clear the event ID from the pickup
      await prisma.pickupSchedule.update({
        where: { id: pickupScheduleId },
        data: { googleEventId: null },
      });
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error deleting calendar event:", error);
    return false;
  }
}

/**
 * Parse time slot string (e.g., "12:00 PM - 2:00 PM")
 */
function parseTimeSlot(timeSlot: string): {
  startTime: { hour: number; minute: number };
  endTime: { hour: number; minute: number };
} {
  const parts = timeSlot.split(" - ");
  return {
    startTime: parseTime(parts[0] || "12:00 PM"),
    endTime: parseTime(parts[1] || "2:00 PM"),
  };
}

/**
 * Parse time string (e.g., "12:00 PM")
 */
function parseTime(time: string): { hour: number; minute: number } {
  const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    return { hour: 12, minute: 0 };
  }

  let hour = parseInt(match[1]);
  const minute = parseInt(match[2]);
  const period = match[3].toUpperCase();

  if (period === "PM" && hour !== 12) {
    hour += 12;
  } else if (period === "AM" && hour === 12) {
    hour = 0;
  }

  return { hour, minute };
}

/**
 * Get Google Calendar color ID based on status
 */
function getStatusColor(status: string): string {
  // Google Calendar color IDs:
  // 1 = Lavender, 2 = Sage, 3 = Grape, 4 = Flamingo
  // 5 = Banana, 6 = Tangerine, 7 = Peacock, 8 = Graphite
  // 9 = Blueberry, 10 = Basil, 11 = Tomato
  switch (status) {
    case "SCHEDULED":
      return "7"; // Peacock (blue)
    case "READY":
      return "10"; // Basil (green)
    case "PICKED_UP":
      return "8"; // Graphite (gray)
    case "CANCELLED":
      return "11"; // Tomato (red)
    case "NO_SHOW":
      return "6"; // Tangerine (orange)
    default:
      return "7";
  }
}

/**
 * Disconnect Google Calendar for a shop
 */
export async function disconnectGoogleCalendar(shop: string): Promise<void> {
  await prisma.googleCalendarAuth.delete({
    where: { shop },
  });
}
