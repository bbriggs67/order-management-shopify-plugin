/**
 * Subscription Processing Service
 * Handles automatic pickup generation and billing for subscriptions
 */

import prisma from "../db.server";
import {
  getTodayPacific,
  getDatePacific,
  getDayOfWeekPacific,
  formatDateISOPacific,
  SHOP_TIMEZONE,
} from "../utils/timezone.server";
import { createPickupEvent } from "./google-calendar.server";
import {
  calculateBillingDate,
  extractTimeSlotStart,
} from "./subscription-billing.server";
import { findFrequencyByLabel } from "./subscription-plans.server";

/**
 * Process all active subscriptions that need pickup generation
 * Should be called daily via a cron job or scheduled task
 */
export async function processSubscriptions(shop: string): Promise<{
  processed: number;
  created: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processed = 0;
  let created = 0;

  const today = getTodayPacific();

  // Find active subscriptions where:
  // 1. Next pickup date is today or in the past (needs processing)
  // 2. Status is ACTIVE
  const subscriptions = await prisma.subscriptionPickup.findMany({
    where: {
      shop,
      status: "ACTIVE",
      nextPickupDate: {
        lte: today,
      },
    },
  });

  for (const subscription of subscriptions) {
    processed++;

    try {
      // Create pickup schedule for this subscription
      const pickupSchedule = await prisma.pickupSchedule.create({
        data: {
          shop,
          shopifyOrderId: `subscription-${subscription.id}-${Date.now()}`,
          shopifyOrderNumber: `SUB-${subscription.id.slice(-6).toUpperCase()}`,
          customerName: subscription.customerName,
          customerEmail: subscription.customerEmail,
          customerPhone: subscription.customerPhone,
          pickupDate: subscription.nextPickupDate!,
          pickupTimeSlot: subscription.preferredTimeSlot,
          pickupStatus: "SCHEDULED",
          subscriptionPickupId: subscription.id,
        },
      });

      created++;

      // Create Google Calendar event if connected
      try {
        await createPickupEvent(shop, pickupSchedule.id);
      } catch (error) {
        console.error("Failed to create calendar event for subscription pickup:", error);
      }

      // Calculate next pickup date
      const nextPickupDate = calculateNextPickupDate(
        subscription.nextPickupDate!,
        subscription.preferredDay,
        subscription.frequency
      );

      // Get time slot start for billing calculation
      const timeSlotStart =
        subscription.preferredTimeSlotStart ||
        extractTimeSlotStart(subscription.preferredTimeSlot);

      // Calculate next billing date using subscription's custom lead hours
      const nextBillingDate = calculateBillingDate(
        nextPickupDate,
        timeSlotStart,
        subscription.billingLeadHours
      );

      // Update subscription with next dates and clear any one-time reschedule
      // (so it doesn't persist as a permanent shift to future pickups)
      await prisma.subscriptionPickup.update({
        where: { id: subscription.id },
        data: {
          nextPickupDate,
          nextBillingDate,
          preferredTimeSlotStart: timeSlotStart, // Store for future use
          // Clear one-time reschedule after processing
          oneTimeRescheduleDate: null,
          oneTimeRescheduleTimeSlot: null,
          oneTimeRescheduleReason: null,
          oneTimeRescheduleBy: null,
          oneTimeRescheduleAt: null,
        },
      });

      console.log(
        `Created pickup ${pickupSchedule.id} for subscription ${subscription.id}, next pickup: ${formatDateISOPacific(nextPickupDate)}`
      );
    } catch (error) {
      const errorMsg = `Failed to process subscription ${subscription.id}: ${error}`;
      console.error(errorMsg);
      errors.push(errorMsg);
    }
  }

  return { processed, created, errors };
}

/**
 * Check for subscriptions that need billing reminders
 * Billing happens 4 days before pickup
 */
export async function checkBillingReminders(shop: string): Promise<{
  subscriptions: Array<{
    id: string;
    customerName: string;
    customerEmail: string | null;
    nextPickupDate: Date;
    nextBillingDate: Date;
  }>;
}> {
  const today = getTodayPacific();

  // Find subscriptions where billing date is today
  const subscriptions = await prisma.subscriptionPickup.findMany({
    where: {
      shop,
      status: "ACTIVE",
      nextBillingDate: {
        gte: today,
        lt: new Date(today.getTime() + 24 * 60 * 60 * 1000), // Today only
      },
    },
    select: {
      id: true,
      customerName: true,
      customerEmail: true,
      nextPickupDate: true,
      nextBillingDate: true,
    },
  });

  return {
    subscriptions: subscriptions.map((s) => ({
      ...s,
      nextPickupDate: s.nextPickupDate!,
      nextBillingDate: s.nextBillingDate!,
    })),
  };
}

/**
 * Resume paused subscriptions that have reached their pausedUntil date
 */
export async function resumePausedSubscriptions(shop: string): Promise<number> {
  const today = getTodayPacific();

  // Find paused subscriptions where pausedUntil is today or past
  const pausedSubscriptions = await prisma.subscriptionPickup.findMany({
    where: {
      shop,
      status: "PAUSED",
      pausedUntil: {
        lte: today,
      },
    },
  });

  let resumed = 0;

  for (const subscription of pausedSubscriptions) {
    // Skip subscriptions paused due to billing failures - they need manual retry
    if (
      subscription.billingFailureCount >= 3 &&
      subscription.pauseReason?.includes("Billing failed")
    ) {
      console.log(
        `Skipping auto-resume for subscription ${subscription.id} - paused due to billing failures`
      );
      continue;
    }

    // Calculate next pickup date
    const nextPickupDate = calculateNextPickupDateFromToday(
      subscription.preferredDay,
      subscription.frequency
    );

    // Get time slot start for billing calculation
    const timeSlotStart =
      subscription.preferredTimeSlotStart ||
      extractTimeSlotStart(subscription.preferredTimeSlot);

    // Calculate next billing date using subscription's custom lead hours
    const nextBillingDate = calculateBillingDate(
      nextPickupDate,
      timeSlotStart,
      subscription.billingLeadHours
    );

    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        pausedUntil: null,
        pauseReason: null,
        nextPickupDate,
        nextBillingDate,
        preferredTimeSlotStart: timeSlotStart,
      },
    });

    resumed++;
    console.log(`Auto-resumed subscription ${subscription.id}`);
  }

  return resumed;
}

/**
 * Get subscription statistics for a shop
 */
export async function getSubscriptionStats(shop: string): Promise<{
  active: number;
  paused: number;
  cancelled: number;
  weeklyRevenue: number;
  upcomingPickups: number;
}> {
  const today = getTodayPacific();
  const weekEnd = getDatePacific(7);

  const [active, paused, cancelled, upcomingPickups] = await Promise.all([
    prisma.subscriptionPickup.count({
      where: { shop, status: "ACTIVE" },
    }),
    prisma.subscriptionPickup.count({
      where: { shop, status: "PAUSED" },
    }),
    prisma.subscriptionPickup.count({
      where: { shop, status: "CANCELLED" },
    }),
    prisma.subscriptionPickup.count({
      where: {
        shop,
        status: "ACTIVE",
        nextPickupDate: {
          gte: today,
          lt: weekEnd,
        },
      },
    }),
  ]);

  // Note: weeklyRevenue would need order value data from Shopify
  // For now, return 0 as a placeholder
  return {
    active,
    paused,
    cancelled,
    weeklyRevenue: 0,
    upcomingPickups,
  };
}

/**
 * Calculate next pickup date after a given date
 */
function calculateNextPickupDate(
  afterDate: Date,
  preferredDay: number,
  frequency: string
): Date {
  const increment = frequency === "WEEKLY" ? 7 : frequency === "TRIWEEKLY" ? 21 : 14;
  const nextDate = new Date(afterDate);
  nextDate.setDate(nextDate.getDate() + increment);

  // Adjust to preferred day if needed
  const nextDay = nextDate.getDay();
  if (nextDay !== preferredDay) {
    let diff = preferredDay - nextDay;
    if (diff < 0) diff += 7;
    nextDate.setDate(nextDate.getDate() + diff);
  }

  return nextDate;
}

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
 * Create a new subscription from an order that contains a selling plan
 * This is used when we detect a subscription purchase via the orders/create webhook
 */
export async function createSubscriptionFromOrder(
  shop: string,
  orderId: string,
  orderNumber: string,
  customerName: string,
  customerEmail: string | null,
  customerPhone: string | null,
  frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY",
  preferredDay: number,
  preferredTimeSlot: string,
  productTitle: string,
  discountPercentOverride?: number,
  billingLeadHoursOverride?: number
): Promise<string> {
  // Check if we already have a subscription for this order
  const existingSubscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      shopifyContractId: orderId,
    },
  });

  if (existingSubscription) {
    console.log(`Subscription already exists for order ${orderId}`);
    return existingSubscription.id;
  }

  // Look up discount/billing from DB, fall back to overrides or hardcoded defaults
  let discountPercent: number;
  let billingLeadHours: number;

  if (discountPercentOverride !== undefined) {
    discountPercent = discountPercentOverride;
    billingLeadHours = billingLeadHoursOverride ?? 48;
  } else {
    const dbFrequency = await findFrequencyByLabel(shop, frequency);
    if (dbFrequency) {
      discountPercent = dbFrequency.discountPercent;
      billingLeadHours = billingLeadHoursOverride ?? dbFrequency.group.billingLeadHours;
      console.log(`Using DB frequency for order: discount=${discountPercent}%, billingLeadHours=${billingLeadHours}`);
    } else {
      console.warn(`No DB frequency found for ${frequency}, using hardcoded defaults`);
      switch (frequency) {
        case "WEEKLY": discountPercent = 10; break;
        case "BIWEEKLY": discountPercent = 5; break;
        case "TRIWEEKLY": discountPercent = 2.5; break;
        default: discountPercent = 5;
      }
      billingLeadHours = billingLeadHoursOverride ?? 48;
    }
  }

  const nextPickupDate = calculateNextPickupDateFromToday(preferredDay, frequency);

  // Extract time slot start for billing calculation
  const preferredTimeSlotStart = extractTimeSlotStart(preferredTimeSlot);

  // Calculate billing date using plan-specified lead hours
  const nextBillingDate = calculateBillingDate(nextPickupDate, preferredTimeSlotStart, billingLeadHours);

  // Note: shopifyContractId is set to orderId as a temporary placeholder for
  // deduplication. The subscription_contracts.create webhook should update this
  // to the actual contract GID when it fires. Using order GID here because we
  // don't have the contract ID yet at order creation time.
  const subscription = await prisma.subscriptionPickup.create({
    data: {
      shop,
      shopifyContractId: orderId,
      shopifyOrderId: orderId,
      shopifyOrderNumber: orderNumber,
      customerName,
      customerEmail,
      customerPhone,
      preferredDay,
      preferredTimeSlot,
      preferredTimeSlotStart,
      frequency,
      discountPercent,
      billingLeadHours,
      nextPickupDate,
      nextBillingDate,
      status: "ACTIVE",
    },
  });

  console.log(`Created subscription ${subscription.id} from order ${orderNumber} (${orderId}) for product: ${productTitle}`);
  return subscription.id;
}

/**
 * Create a new subscription from a Shopify subscription contract webhook
 */
export async function createSubscriptionFromContract(
  shop: string,
  contractId: string,
  customerName: string,
  customerEmail: string | null,
  customerPhone: string | null,
  frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY",
  preferredDay: number,
  preferredTimeSlot: string,
  discountPercentOverride?: number,
  billingLeadHoursOverride?: number
): Promise<string> {
  // Look up discount/billing from DB, fall back to overrides or hardcoded defaults
  let discountPercent: number;
  let billingLeadHours: number;

  if (discountPercentOverride !== undefined) {
    discountPercent = discountPercentOverride;
    billingLeadHours = billingLeadHoursOverride ?? 48;
  } else {
    const dbFrequency = await findFrequencyByLabel(shop, frequency);
    if (dbFrequency) {
      discountPercent = dbFrequency.discountPercent;
      billingLeadHours = billingLeadHoursOverride ?? dbFrequency.group.billingLeadHours;
      console.log(`Using DB frequency for contract: discount=${discountPercent}%, billingLeadHours=${billingLeadHours}`);
    } else {
      console.warn(`No DB frequency found for ${frequency}, using hardcoded defaults`);
      switch (frequency) {
        case "WEEKLY": discountPercent = 10; break;
        case "BIWEEKLY": discountPercent = 5; break;
        case "TRIWEEKLY": discountPercent = 2.5; break;
        default: discountPercent = 5;
      }
      billingLeadHours = billingLeadHoursOverride ?? 48;
    }
  }

  const nextPickupDate = calculateNextPickupDateFromToday(preferredDay, frequency);

  // Extract time slot start for billing calculation
  const preferredTimeSlotStart = extractTimeSlotStart(preferredTimeSlot);

  // Calculate billing date using plan-specified lead hours
  const nextBillingDate = calculateBillingDate(nextPickupDate, preferredTimeSlotStart, billingLeadHours);

  const subscription = await prisma.subscriptionPickup.create({
    data: {
      shop,
      shopifyContractId: contractId,
      customerName,
      customerEmail,
      customerPhone,
      preferredDay,
      preferredTimeSlot,
      preferredTimeSlotStart,
      frequency,
      discountPercent,
      billingLeadHours,
      nextPickupDate,
      nextBillingDate,
      status: "ACTIVE",
    },
  });

  console.log(`Created subscription ${subscription.id} from contract ${contractId}`);
  return subscription.id;
}
