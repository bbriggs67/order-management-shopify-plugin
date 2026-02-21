/**
 * Customer Subscription Service
 * Handles customer-facing subscription actions: pause, resume, cancel
 * Used by the App Proxy customer portal
 */

import prisma from "../db.server";
import {
  calculateBillingDate,
  extractTimeSlotStart,
} from "./subscription-billing.server";
import {
  getDatePacific,
  getDayOfWeekPacific,
  getTodayPacific,
} from "../utils/timezone.server";

// ============================================
// Types
// ============================================

export interface CustomerSubscription {
  id: string;
  status: string;
  frequency: string;
  preferredDay: number;
  preferredTimeSlot: string;
  discountPercent: number;
  nextPickupDate: Date | null;
  pausedUntil: Date | null;
  pauseReason: string | null;
  // One-time reschedule fields
  oneTimeRescheduleDate: Date | null;
  oneTimeRescheduleTimeSlot: string | null;
  oneTimeRescheduleReason: string | null;
}

export interface SubscriptionAction {
  action: "pause" | "resume" | "cancel";
  comment?: string;
  pauseUntil?: Date;
}

export interface ActionResult {
  success: boolean;
  message: string;
  subscription?: CustomerSubscription;
}

// ============================================
// Customer Authentication
// ============================================

/**
 * Get subscription by customer email and contract ID
 * This provides a simple lookup for customers via app proxy
 */
export async function getCustomerSubscription(
  shop: string,
  customerEmail: string,
  subscriptionId?: string
): Promise<CustomerSubscription | null> {
  const where: {
    shop: string;
    customerEmail: string;
    id?: string;
  } = {
    shop,
    customerEmail: customerEmail.toLowerCase().trim(),
  };

  if (subscriptionId) {
    where.id = subscriptionId;
  }

  const subscription = await prisma.subscriptionPickup.findFirst({
    where,
    select: {
      id: true,
      status: true,
      frequency: true,
      preferredDay: true,
      preferredTimeSlot: true,
      discountPercent: true,
      nextPickupDate: true,
      pausedUntil: true,
      pauseReason: true,
      oneTimeRescheduleDate: true,
      oneTimeRescheduleTimeSlot: true,
      oneTimeRescheduleReason: true,
    },
  });

  if (!subscription) {
    return null;
  }

  return {
    id: subscription.id,
    status: subscription.status,
    frequency: subscription.frequency,
    preferredDay: subscription.preferredDay,
    preferredTimeSlot: subscription.preferredTimeSlot,
    discountPercent: subscription.discountPercent,
    nextPickupDate: subscription.nextPickupDate,
    pausedUntil: subscription.pausedUntil,
    pauseReason: subscription.pauseReason,
    oneTimeRescheduleDate: subscription.oneTimeRescheduleDate,
    oneTimeRescheduleTimeSlot: subscription.oneTimeRescheduleTimeSlot,
    oneTimeRescheduleReason: subscription.oneTimeRescheduleReason,
  };
}

/**
 * Get all subscriptions for a customer
 */
export async function getCustomerSubscriptions(
  shop: string,
  customerEmail: string
): Promise<CustomerSubscription[]> {
  const subscriptions = await prisma.subscriptionPickup.findMany({
    where: {
      shop,
      customerEmail: customerEmail.toLowerCase().trim(),
      status: { not: "CANCELLED" }, // Show active and paused only
    },
    select: {
      id: true,
      status: true,
      frequency: true,
      preferredDay: true,
      preferredTimeSlot: true,
      discountPercent: true,
      nextPickupDate: true,
      pausedUntil: true,
      pauseReason: true,
      oneTimeRescheduleDate: true,
      oneTimeRescheduleTimeSlot: true,
      oneTimeRescheduleReason: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return subscriptions.map((s) => ({
    id: s.id,
    status: s.status,
    frequency: s.frequency,
    preferredDay: s.preferredDay,
    preferredTimeSlot: s.preferredTimeSlot,
    discountPercent: s.discountPercent,
    nextPickupDate: s.nextPickupDate,
    pausedUntil: s.pausedUntil,
    pauseReason: s.pauseReason,
    oneTimeRescheduleDate: s.oneTimeRescheduleDate,
    oneTimeRescheduleTimeSlot: s.oneTimeRescheduleTimeSlot,
    oneTimeRescheduleReason: s.oneTimeRescheduleReason,
  }));
}

// ============================================
// Customer Actions
// ============================================

/**
 * Pause a subscription (customer action)
 */
export async function customerPauseSubscription(
  shop: string,
  subscriptionId: string,
  customerEmail: string,
  comment?: string,
  pauseUntil?: Date
): Promise<ActionResult> {
  // Verify ownership
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      id: subscriptionId,
      customerEmail: customerEmail.toLowerCase().trim(),
    },
  });

  if (!subscription) {
    return {
      success: false,
      message: "Subscription not found or you don't have access to it.",
    };
  }

  if (subscription.status === "CANCELLED") {
    return {
      success: false,
      message: "Cannot pause a cancelled subscription.",
    };
  }

  if (subscription.status === "PAUSED") {
    return {
      success: false,
      message: "Subscription is already paused.",
    };
  }

  const pauseReason = comment
    ? `Customer paused: ${comment}`
    : "Customer paused subscription";

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      status: "PAUSED",
      pausedUntil: pauseUntil || null,
      pauseReason,
    },
  });

  console.log(
    `Customer paused subscription ${subscriptionId}: ${pauseReason}`
  );

  return {
    success: true,
    message: pauseUntil
      ? `Your subscription has been paused until ${pauseUntil.toLocaleDateString()}.`
      : "Your subscription has been paused. You can resume it anytime.",
  };
}

/**
 * Resume a subscription (customer action)
 */
export async function customerResumeSubscription(
  shop: string,
  subscriptionId: string,
  customerEmail: string,
  comment?: string
): Promise<ActionResult> {
  // Verify ownership
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      id: subscriptionId,
      customerEmail: customerEmail.toLowerCase().trim(),
    },
  });

  if (!subscription) {
    return {
      success: false,
      message: "Subscription not found or you don't have access to it.",
    };
  }

  if (subscription.status === "CANCELLED") {
    return {
      success: false,
      message: "Cannot resume a cancelled subscription. Please contact us to reactivate.",
    };
  }

  if (subscription.status === "ACTIVE") {
    return {
      success: false,
      message: "Subscription is already active.",
    };
  }

  // Calculate next pickup date from today
  const nextPickupDate = calculateNextPickupDateFromToday(
    subscription.preferredDay,
    subscription.frequency
  );

  // Get time slot start for billing calculation
  const timeSlotStart =
    subscription.preferredTimeSlotStart ||
    extractTimeSlotStart(subscription.preferredTimeSlot);

  // Calculate next billing date
  const nextBillingDate = calculateBillingDate(
    nextPickupDate,
    timeSlotStart,
    subscription.billingLeadHours
  );

  const resumeNote = comment
    ? `Customer resumed: ${comment}`
    : "Customer resumed subscription";

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      status: "ACTIVE",
      pausedUntil: null,
      pauseReason: null,
      nextPickupDate,
      nextBillingDate,
      preferredTimeSlotStart: timeSlotStart,
      // Append resume note to admin notes if there was a comment
      ...(comment && {
        adminNotes: subscription.adminNotes
          ? `${subscription.adminNotes}\n${new Date().toISOString()}: ${resumeNote}`
          : `${new Date().toISOString()}: ${resumeNote}`,
      }),
    },
  });

  console.log(`Customer resumed subscription ${subscriptionId}: ${resumeNote}`);

  return {
    success: true,
    message: `Your subscription has been resumed! Your next pickup is scheduled for ${nextPickupDate.toLocaleDateString()}.`,
  };
}

/**
 * Cancel a subscription (customer action)
 */
export async function customerCancelSubscription(
  shop: string,
  subscriptionId: string,
  customerEmail: string,
  comment?: string
): Promise<ActionResult> {
  // Verify ownership
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      id: subscriptionId,
      customerEmail: customerEmail.toLowerCase().trim(),
    },
  });

  if (!subscription) {
    return {
      success: false,
      message: "Subscription not found or you don't have access to it.",
    };
  }

  if (subscription.status === "CANCELLED") {
    return {
      success: false,
      message: "Subscription is already cancelled.",
    };
  }

  const cancelReason = comment
    ? `Customer cancelled: ${comment}`
    : "Customer cancelled subscription";

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      status: "CANCELLED",
      pausedUntil: null,
      pauseReason: cancelReason,
      nextPickupDate: null,
      nextBillingDate: null,
      // Log cancellation in admin notes
      adminNotes: subscription.adminNotes
        ? `${subscription.adminNotes}\n${new Date().toISOString()}: ${cancelReason}`
        : `${new Date().toISOString()}: ${cancelReason}`,
    },
  });

  console.log(
    `Customer cancelled subscription ${subscriptionId}: ${cancelReason}`
  );

  return {
    success: true,
    message: "Your subscription has been cancelled. We're sorry to see you go! Feel free to reach out if you have any questions.",
  };
}

// ============================================
// Customer Reschedule Actions
// ============================================

/**
 * One-time reschedule for customer (customer action)
 */
export async function customerOneTimeReschedule(
  shop: string,
  subscriptionId: string,
  customerEmail: string,
  newPickupDate: Date,
  newTimeSlot: string,
  reason?: string
): Promise<ActionResult> {
  // Verify ownership
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      id: subscriptionId,
      customerEmail: customerEmail.toLowerCase().trim(),
    },
  });

  if (!subscription) {
    return {
      success: false,
      message: "Subscription not found or you don't have access to it.",
    };
  }

  if (subscription.status !== "ACTIVE") {
    return {
      success: false,
      message: "Can only reschedule active subscriptions.",
    };
  }

  // Extract time slot start for billing calculation
  const timeSlotStart = extractTimeSlotStart(newTimeSlot);

  // Calculate new billing date
  const newBillingDate = calculateBillingDate(
    newPickupDate,
    timeSlotStart,
    subscription.billingLeadHours
  );

  // Check if billing date is in the past
  const now = new Date();
  if (newBillingDate < now) {
    return {
      success: false,
      message: `The selected date is too soon. Please choose a pickup date at least ${Math.ceil(subscription.billingLeadHours / 24)} days from now to allow for billing.`,
    };
  }

  const rescheduleNote = reason
    ? `Customer rescheduled: ${reason}`
    : "Customer rescheduled next pickup";

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      oneTimeRescheduleDate: newPickupDate,
      oneTimeRescheduleTimeSlot: newTimeSlot,
      oneTimeRescheduleReason: reason || null,
      oneTimeRescheduleBy: "CUSTOMER",
      oneTimeRescheduleAt: new Date(),
      nextPickupDate: newPickupDate,
      nextBillingDate: newBillingDate,
      // Log in admin notes
      adminNotes: subscription.adminNotes
        ? `${subscription.adminNotes}\n${new Date().toISOString()}: ${rescheduleNote}`
        : `${new Date().toISOString()}: ${rescheduleNote}`,
    },
  });

  console.log(
    `Customer rescheduled subscription ${subscriptionId} to ${newPickupDate.toISOString()}`
  );

  return {
    success: true,
    message: `Your next pickup has been rescheduled to ${newPickupDate.toLocaleDateString()} at ${newTimeSlot}. After this pickup, your subscription will return to its regular schedule.`,
  };
}

/**
 * Clear one-time reschedule and revert to regular schedule (customer action)
 */
export async function customerClearOneTimeReschedule(
  shop: string,
  subscriptionId: string,
  customerEmail: string
): Promise<ActionResult> {
  // Verify ownership
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      id: subscriptionId,
      customerEmail: customerEmail.toLowerCase().trim(),
    },
  });

  if (!subscription) {
    return {
      success: false,
      message: "Subscription not found or you don't have access to it.",
    };
  }

  if (!subscription.oneTimeRescheduleDate) {
    return {
      success: false,
      message: "No reschedule to clear.",
    };
  }

  // Recalculate next pickup based on regular schedule
  const nextPickupDate = calculateNextPickupDateFromToday(
    subscription.preferredDay,
    subscription.frequency
  );

  const timeSlotStart =
    subscription.preferredTimeSlotStart ||
    extractTimeSlotStart(subscription.preferredTimeSlot);

  const nextBillingDate = calculateBillingDate(
    nextPickupDate,
    timeSlotStart,
    subscription.billingLeadHours
  );

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      nextPickupDate,
      nextBillingDate,
      oneTimeRescheduleDate: null,
      oneTimeRescheduleTimeSlot: null,
      oneTimeRescheduleReason: null,
      oneTimeRescheduleBy: null,
      oneTimeRescheduleAt: null,
      adminNotes: subscription.adminNotes
        ? `${subscription.adminNotes}\n${new Date().toISOString()}: Customer cleared one-time reschedule`
        : `${new Date().toISOString()}: Customer cleared one-time reschedule`,
    },
  });

  console.log(`Customer cleared reschedule for subscription ${subscriptionId}`);

  return {
    success: true,
    message: `Your pickup has been reverted to the regular schedule. Next pickup: ${nextPickupDate.toLocaleDateString()}.`,
  };
}

/**
 * Permanent reschedule - change preferred day/time (customer action)
 */
export async function customerPermanentReschedule(
  shop: string,
  subscriptionId: string,
  customerEmail: string,
  newPreferredDay: number,
  newTimeSlot: string,
  reason?: string
): Promise<ActionResult> {
  // Verify ownership
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      id: subscriptionId,
      customerEmail: customerEmail.toLowerCase().trim(),
    },
  });

  if (!subscription) {
    return {
      success: false,
      message: "Subscription not found or you don't have access to it.",
    };
  }

  if (subscription.status === "CANCELLED") {
    return {
      success: false,
      message: "Cannot change a cancelled subscription.",
    };
  }

  // Validate day of week
  if (newPreferredDay < 0 || newPreferredDay > 6) {
    return {
      success: false,
      message: "Invalid pickup day selected.",
    };
  }

  const timeSlotStart = extractTimeSlotStart(newTimeSlot);

  // Calculate next pickup based on new preferred day
  const nextPickupDate = calculateNextPickupDateFromToday(
    newPreferredDay,
    subscription.frequency
  );

  const nextBillingDate = calculateBillingDate(
    nextPickupDate,
    timeSlotStart,
    subscription.billingLeadHours
  );

  const dayName = getDayName(newPreferredDay);
  const changeNote = reason
    ? `Customer changed schedule to ${dayName}s at ${newTimeSlot}: ${reason}`
    : `Customer changed schedule to ${dayName}s at ${newTimeSlot}`;

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      preferredDay: newPreferredDay,
      preferredTimeSlot: newTimeSlot,
      preferredTimeSlotStart: timeSlotStart,
      nextPickupDate,
      nextBillingDate,
      // Clear any one-time reschedule
      oneTimeRescheduleDate: null,
      oneTimeRescheduleTimeSlot: null,
      oneTimeRescheduleReason: null,
      oneTimeRescheduleBy: null,
      oneTimeRescheduleAt: null,
      adminNotes: subscription.adminNotes
        ? `${subscription.adminNotes}\n${new Date().toISOString()}: ${changeNote}`
        : `${new Date().toISOString()}: ${changeNote}`,
    },
  });

  console.log(
    `Customer permanently changed subscription ${subscriptionId} to ${dayName}s at ${newTimeSlot}`
  );

  return {
    success: true,
    message: `Your subscription has been updated! You'll now pick up on ${dayName}s at ${newTimeSlot}. Next pickup: ${nextPickupDate.toLocaleDateString()}.`,
  };
}

/**
 * Get available pickup days for the shop
 */
export async function getAvailablePickupDays(shop: string): Promise<number[]> {
  const pickupDayConfigs = await prisma.pickupDayConfig.findMany({
    where: { shop, isEnabled: true },
    orderBy: { dayOfWeek: "asc" },
  });

  if (pickupDayConfigs.length === 0) {
    // Default to Tue, Wed, Fri, Sat if not configured
    return [2, 3, 5, 6];
  }

  return pickupDayConfigs.map((config) => config.dayOfWeek);
}

/**
 * Get available time slots for the shop
 */
export async function getAvailableTimeSlots(
  shop: string
): Promise<Array<{ label: string; startTime: string }>> {
  const timeSlots = await prisma.timeSlot.findMany({
    where: { shop, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  return timeSlots.map((slot) => ({
    label: slot.label,
    startTime: slot.startTime,
  }));
}

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate next pickup date from today
 */
function calculateNextPickupDateFromToday(
  preferredDay: number,
  frequency: string
): Date {
  const today = getTodayPacific();
  const currentDay = getDayOfWeekPacific(today);

  // Find days until next preferred day
  let daysUntil = preferredDay - currentDay;
  if (daysUntil <= 0) {
    daysUntil += 7;
  }

  // For bi-weekly, ensure we're at least 7 days out
  if (frequency === "BIWEEKLY" && daysUntil < 7) {
    daysUntil += 7;
  }

  // For tri-weekly, ensure we're at least 14 days out
  if (frequency === "TRIWEEKLY" && daysUntil < 14) {
    daysUntil += 14;
  }

  const nextDate = getDatePacific(daysUntil);
  return nextDate;
}

/**
 * Verify customer email matches Shopify logged-in customer
 * This is called from the App Proxy route with Shopify's customer data
 */
export function verifyCustomerAccess(
  subscriptionEmail: string | null,
  loggedInEmail: string
): boolean {
  if (!subscriptionEmail) return false;
  return (
    subscriptionEmail.toLowerCase().trim() ===
    loggedInEmail.toLowerCase().trim()
  );
}

/**
 * Get day name from day number
 */
export function getDayName(dayOfWeek: number): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[dayOfWeek] || "Unknown";
}
