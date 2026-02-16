/**
 * Subscription Billing Service
 * Handles programmatic billing 84 hours before scheduled pickups
 */

import prisma from "../db.server";
import {
  getNowInPacific,
  getTodayPacific,
  getDayOfWeekPacific,
  getDatePacific,
  formatDateISOPacific,
} from "../utils/timezone.server";
import { updatePickupEventDateTime } from "./google-calendar.server";
import {
  DEFAULT_BILLING_LEAD_HOURS,
  MIN_BILLING_LEAD_HOURS,
  MAX_BILLING_LEAD_HOURS,
  MAX_BILLING_FAILURES,
} from "../utils/constants.server";

// Type for the admin GraphQL client returned by authenticate.admin()
interface AdminClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

// ============================================
// Types
// ============================================

export interface BillingResult {
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
}

interface BillingAttemptCreateResponse {
  subscriptionBillingAttemptCreate: {
    subscriptionBillingAttempt: {
      id: string;
      ready: boolean;
      errorCode: string | null;
    } | null;
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

interface SubscriptionContractQueryResponse {
  subscriptionContract: {
    id: string;
    status: string;
    customer: {
      id: string;
      email: string;
    };
    nextBillingDate: string | null;
  } | null;
}

// ============================================
// GraphQL Mutations
// ============================================

const SUBSCRIPTION_BILLING_ATTEMPT_CREATE = `
  mutation subscriptionBillingAttemptCreate(
    $subscriptionContractId: ID!
    $idempotencyKey: String!
    $originTime: DateTime
  ) {
    subscriptionBillingAttemptCreate(
      subscriptionContractId: $subscriptionContractId
      subscriptionBillingAttemptInput: {
        idempotencyKey: $idempotencyKey
        originTime: $originTime
      }
    ) {
      subscriptionBillingAttempt {
        id
        ready
        errorCode
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SUBSCRIPTION_CONTRACT_QUERY = `
  query getSubscriptionContract($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      customer {
        id
        email
      }
      nextBillingDate
    }
  }
`;

// ============================================
// Billing Date Calculation
// ============================================

/**
 * Calculate billing date based on pickup date, time slot, and lead hours
 *
 * @param pickupDate - The scheduled pickup date
 * @param timeSlotStart - Time slot start in "HH:MM" format (24-hour)
 * @param leadHours - Hours before pickup to charge (1-168, default 84)
 *
 * Example with default 84 hours:
 * - Pickup: Saturday 12:00 PM
 * - 84 hours = 3.5 days before
 * - Billing: Tuesday 12:00 AM (midnight Tuesday night)
 */
export function calculateBillingDate(
  pickupDate: Date,
  timeSlotStart: string, // "12:00" format
  leadHours: number = DEFAULT_BILLING_LEAD_HOURS
): Date {
  // Validate lead hours within bounds
  const validLeadHours = Math.max(MIN_BILLING_LEAD_HOURS, Math.min(MAX_BILLING_LEAD_HOURS, leadHours));

  // Parse the time slot start
  const [hours, minutes] = timeSlotStart.split(":").map(Number);

  // Create pickup datetime
  const pickupDateTime = new Date(pickupDate);
  pickupDateTime.setHours(hours, minutes, 0, 0);

  // Subtract lead hours
  const billingDate = new Date(pickupDateTime.getTime() - validLeadHours * 60 * 60 * 1000);

  return billingDate;
}

/**
 * Validate and normalize billing lead hours
 * Returns a value between MIN_BILLING_LEAD_HOURS and MAX_BILLING_LEAD_HOURS
 */
export function validateBillingLeadHours(hours: number): number {
  return Math.max(MIN_BILLING_LEAD_HOURS, Math.min(MAX_BILLING_LEAD_HOURS, hours));
}

/**
 * Get billing lead hours constraints for UI
 */
export function getBillingLeadHoursConfig() {
  return {
    min: MIN_BILLING_LEAD_HOURS,
    max: MAX_BILLING_LEAD_HOURS,
    default: DEFAULT_BILLING_LEAD_HOURS,
  };
}

/**
 * Extract the start time from a time slot string
 * "12:00 PM - 2:00 PM" -> "12:00"
 */
export function extractTimeSlotStart(timeSlot: string): string {
  // Match patterns like "12:00 PM" or "9:00 AM"
  const match = timeSlot.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    // Default to noon if we can't parse
    return "12:00";
  }

  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const period = match[3].toUpperCase();

  // Convert to 24-hour format
  if (period === "PM" && hour !== 12) {
    hour += 12;
  } else if (period === "AM" && hour === 12) {
    hour = 0;
  }

  return `${hour.toString().padStart(2, "0")}:${minute}`;
}

/**
 * Calculate next pickup date after current one
 */
export function calculateNextPickupDate(
  currentPickupDate: Date,
  preferredDay: number,
  frequency: string
): Date {
  const increment = frequency === "WEEKLY" ? 7 : 14;
  const nextDate = new Date(currentPickupDate);
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

// ============================================
// Main Billing Processing
// ============================================

/**
 * Process all subscriptions that are due for billing
 * Should be called from cron job
 */
export async function processDueBillings(
  shop: string,
  admin: AdminClient
): Promise<BillingResult> {
  const result: BillingResult = {
    processed: 0,
    successful: 0,
    failed: 0,
    errors: [],
  };

  const now = getNowInPacific();

  // Find active subscriptions where billing date has passed
  const dueSubscriptions = await prisma.subscriptionPickup.findMany({
    where: {
      shop,
      status: "ACTIVE",
      nextBillingDate: {
        lte: now,
      },
      // Don't process if we've exceeded failure count
      billingFailureCount: {
        lt: MAX_BILLING_FAILURES,
      },
    },
  });

  console.log(`Found ${dueSubscriptions.length} subscriptions due for billing`);

  for (const subscription of dueSubscriptions) {
    result.processed++;

    try {
      await processSingleBilling(shop, admin, subscription);
      result.successful++;
    } catch (error) {
      result.failed++;
      const errorMsg = `Billing failed for subscription ${subscription.id}: ${error}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }
  }

  return result;
}

/**
 * Process billing for a single subscription
 */
async function processSingleBilling(
  shop: string,
  admin: AdminClient,
  subscription: {
    id: string;
    shopifyContractId: string;
    nextPickupDate: Date | null;
    nextBillingDate: Date | null;
    preferredDay: number;
    preferredTimeSlot: string;
    preferredTimeSlotStart: string | null;
    frequency: string;
    billingCycleCount: number;
    billingFailureCount: number;
    billingLeadHours: number;
  }
): Promise<void> {
  // Generate idempotency key
  const billingCycle = subscription.billingCycleCount + 1;
  const idempotencyKey = `${subscription.id}-cycle-${billingCycle}-${Date.now()}`;

  // Check if we already attempted this billing (idempotency)
  const existingAttempt = await prisma.billingAttemptLog.findFirst({
    where: {
      subscriptionPickupId: subscription.id,
      billingCycle,
      status: "SUCCESS",
    },
  });

  if (existingAttempt) {
    console.log(`Billing cycle ${billingCycle} already successful for subscription ${subscription.id}`);
    return;
  }

  // Create billing attempt log entry
  const attemptLog = await prisma.billingAttemptLog.create({
    data: {
      shop,
      subscriptionPickupId: subscription.id,
      idempotencyKey,
      status: "PENDING",
      billingCycle,
    },
  });

  try {
    // Call Shopify to create billing attempt
    const response = await admin.graphql(SUBSCRIPTION_BILLING_ATTEMPT_CREATE, {
      variables: {
        subscriptionContractId: subscription.shopifyContractId,
        idempotencyKey,
        originTime: new Date().toISOString(),
      },
    });

    const data: BillingAttemptCreateResponse = await response.json().then((r: { data: BillingAttemptCreateResponse }) => r.data);

    if (data.subscriptionBillingAttemptCreate.userErrors.length > 0) {
      const errors = data.subscriptionBillingAttemptCreate.userErrors
        .map((e) => e.message)
        .join(", ");
      throw new Error(errors);
    }

    const attempt = data.subscriptionBillingAttemptCreate.subscriptionBillingAttempt;
    if (!attempt) {
      throw new Error("No billing attempt returned from Shopify");
    }

    // Update attempt log
    await prisma.billingAttemptLog.update({
      where: { id: attemptLog.id },
      data: {
        shopifyBillingId: attempt.id,
        status: attempt.ready ? "SUCCESS" : "PENDING",
        errorCode: attempt.errorCode,
      },
    });

    // If ready (success), update subscription
    if (attempt.ready) {
      await handleBillingSuccess(subscription);
    } else if (attempt.errorCode) {
      await handleBillingFailure(subscription, attempt.errorCode, attemptLog.id);
    }
    // If not ready and no error, it's processing - webhook will handle result

    console.log(
      `Billing attempt created for subscription ${subscription.id}: ${attempt.id}, ready: ${attempt.ready}`
    );
  } catch (error) {
    // Update attempt log with failure
    await prisma.billingAttemptLog.update({
      where: { id: attemptLog.id },
      data: {
        status: "FAILED",
        errorMessage: String(error),
      },
    });

    await handleBillingFailure(subscription, "API_ERROR", attemptLog.id, String(error));
    throw error;
  }
}

/**
 * Handle successful billing - calculate next dates
 */
async function handleBillingSuccess(subscription: {
  id: string;
  nextPickupDate: Date | null;
  preferredDay: number;
  preferredTimeSlot: string;
  preferredTimeSlotStart: string | null;
  frequency: string;
  billingCycleCount: number;
  billingLeadHours: number;
}): Promise<void> {
  // Calculate next pickup date
  const nextPickupDate = calculateNextPickupDate(
    subscription.nextPickupDate || new Date(),
    subscription.preferredDay,
    subscription.frequency
  );

  // Get time slot start
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
      nextPickupDate,
      nextBillingDate,
      lastBillingStatus: "SUCCESS",
      lastBillingAttemptAt: new Date(),
      billingFailureCount: 0, // Reset on success
      billingFailureReason: null,
      billingCycleCount: subscription.billingCycleCount + 1,
    },
  });

  console.log(
    `Updated subscription ${subscription.id}: next pickup ${formatDateISOPacific(nextPickupDate)}, next billing ${formatDateISOPacific(nextBillingDate)}`
  );
}

/**
 * Handle failed billing - increment failure count, potentially pause
 */
async function handleBillingFailure(
  subscription: {
    id: string;
    billingFailureCount: number;
  },
  errorCode: string,
  attemptLogId: string,
  errorMessage?: string
): Promise<void> {
  const newFailureCount = subscription.billingFailureCount + 1;

  const updateData: {
    lastBillingStatus: string;
    lastBillingAttemptAt: Date;
    billingFailureCount: number;
    billingFailureReason: string;
    status?: "PAUSED";
    pauseReason?: string;
  } = {
    lastBillingStatus: "FAILED",
    lastBillingAttemptAt: new Date(),
    billingFailureCount: newFailureCount,
    billingFailureReason: errorMessage || errorCode,
  };

  // Pause subscription after max failures
  if (newFailureCount >= MAX_BILLING_FAILURES) {
    updateData.status = "PAUSED";
    updateData.pauseReason = `Billing failed ${MAX_BILLING_FAILURES} times: ${errorCode}`;
    console.log(
      `Pausing subscription ${subscription.id} after ${MAX_BILLING_FAILURES} billing failures`
    );
  }

  await prisma.subscriptionPickup.update({
    where: { id: subscription.id },
    data: updateData,
  });

  // Update attempt log
  await prisma.billingAttemptLog.update({
    where: { id: attemptLogId },
    data: {
      status: "FAILED",
      errorCode,
      errorMessage,
    },
  });
}

// ============================================
// Billing Status Queries
// ============================================

/**
 * Get subscriptions with failed billings for admin dashboard
 */
export async function getFailedBillings(shop: string) {
  return prisma.subscriptionPickup.findMany({
    where: {
      shop,
      lastBillingStatus: "FAILED",
      billingFailureCount: {
        gt: 0,
      },
    },
    orderBy: {
      lastBillingAttemptAt: "desc",
    },
    include: {
      billingAttemptLogs: {
        orderBy: { attemptedAt: "desc" },
        take: 5,
      },
    },
  });
}

/**
 * Get upcoming billings for admin dashboard
 */
export async function getUpcomingBillings(shop: string, daysAhead: number = 7) {
  const now = getNowInPacific();
  const futureDate = getDatePacific(daysAhead);

  return prisma.subscriptionPickup.findMany({
    where: {
      shop,
      status: "ACTIVE",
      nextBillingDate: {
        gte: now,
        lte: futureDate,
      },
    },
    orderBy: {
      nextBillingDate: "asc",
    },
  });
}

/**
 * Retry a failed billing manually
 */
export async function retryBilling(
  shop: string,
  admin: AdminClient,
  subscriptionId: string
): Promise<void> {
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  if (subscription.status !== "ACTIVE" && subscription.status !== "PAUSED") {
    throw new Error("Cannot retry billing for cancelled subscription");
  }

  // If paused due to billing failures, unpause for retry
  if (subscription.status === "PAUSED" && subscription.billingFailureCount >= MAX_BILLING_FAILURES) {
    await prisma.subscriptionPickup.update({
      where: { id: subscriptionId },
      data: {
        status: "ACTIVE",
        billingFailureCount: 0, // Reset for fresh retry
        pauseReason: null,
      },
    });
  }

  // Fetch fresh subscription data
  const freshSubscription = await prisma.subscriptionPickup.findUnique({
    where: { id: subscriptionId },
  });

  if (!freshSubscription) {
    throw new Error("Subscription not found after update");
  }

  await processSingleBilling(shop, admin, freshSubscription);
}

/**
 * Verify subscription contract status in Shopify
 */
export async function verifySubscriptionStatus(
  admin: AdminClient,
  contractId: string
): Promise<{ status: string; nextBillingDate: string | null } | null> {
  const response = await admin.graphql(SUBSCRIPTION_CONTRACT_QUERY, {
    variables: { id: contractId },
  });

  const data: SubscriptionContractQueryResponse = await response.json().then((r: { data: SubscriptionContractQueryResponse }) => r.data);

  if (!data.subscriptionContract) {
    return null;
  }

  return {
    status: data.subscriptionContract.status,
    nextBillingDate: data.subscriptionContract.nextBillingDate,
  };
}

// ============================================
// Subscription Management Functions
// ============================================

/**
 * Pause a subscription with optional reason
 */
export async function pauseSubscription(
  shop: string,
  subscriptionId: string,
  reason?: string,
  pausedUntil?: Date
): Promise<void> {
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  if (subscription.status === "CANCELLED") {
    throw new Error("Cannot pause a cancelled subscription");
  }

  if (subscription.status === "PAUSED") {
    throw new Error("Subscription is already paused");
  }

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      status: "PAUSED",
      pauseReason: reason || "Paused by admin",
      pausedUntil: pausedUntil || null,
    },
  });

  console.log(`Subscription ${subscriptionId} paused: ${reason || "Paused by admin"}`);
}

/**
 * Resume a paused subscription
 */
export async function resumeSubscription(
  shop: string,
  subscriptionId: string
): Promise<void> {
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  if (subscription.status === "CANCELLED") {
    throw new Error("Cannot resume a cancelled subscription");
  }

  if (subscription.status === "ACTIVE") {
    throw new Error("Subscription is already active");
  }

  // Calculate next pickup date from today
  const today = getTodayPacific();
  const nextPickupDate = calculateNextPickupDateFromToday(
    subscription.preferredDay,
    subscription.frequency
  );

  // Get time slot start
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
    where: { id: subscriptionId },
    data: {
      status: "ACTIVE",
      pauseReason: null,
      pausedUntil: null,
      billingFailureCount: 0, // Reset failure count on resume
      billingFailureReason: null,
      nextPickupDate,
      nextBillingDate,
    },
  });

  console.log(`Subscription ${subscriptionId} resumed, next pickup: ${formatDateISOPacific(nextPickupDate)}`);
}

/**
 * Calculate next pickup date from today
 */
function calculateNextPickupDateFromToday(
  preferredDay: number,
  frequency: string
): Date {
  const today = getTodayPacific();
  const todayDay = getDayOfWeekPacific(today);

  let daysUntilPreferred = preferredDay - todayDay;
  if (daysUntilPreferred <= 0) {
    daysUntilPreferred += 7;
  }

  // For biweekly, add an extra week
  if (frequency === "BIWEEKLY") {
    daysUntilPreferred += 7;
  }

  const nextDate = new Date(today);
  nextDate.setDate(nextDate.getDate() + daysUntilPreferred);
  return nextDate;
}

/**
 * Update subscription billing lead hours
 */
export async function updateBillingLeadHours(
  shop: string,
  subscriptionId: string,
  billingLeadHours: number
): Promise<void> {
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  // Validate billing lead hours
  const validLeadHours = validateBillingLeadHours(billingLeadHours);

  // Recalculate next billing date if we have a next pickup date
  let nextBillingDate = subscription.nextBillingDate;
  if (subscription.nextPickupDate) {
    const timeSlotStart =
      subscription.preferredTimeSlotStart ||
      extractTimeSlotStart(subscription.preferredTimeSlot);
    nextBillingDate = calculateBillingDate(
      subscription.nextPickupDate,
      timeSlotStart,
      validLeadHours
    );
  }

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      billingLeadHours: validLeadHours,
      nextBillingDate,
    },
  });

  console.log(`Updated subscription ${subscriptionId} billing lead hours to ${validLeadHours}h`);
}

/**
 * Update subscription admin notes
 */
export async function updateAdminNotes(
  shop: string,
  subscriptionId: string,
  adminNotes: string | null
): Promise<void> {
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      adminNotes,
    },
  });

  console.log(`Updated admin notes for subscription ${subscriptionId}`);
}

/**
 * Get a single subscription by ID
 */
export async function getSubscription(shop: string, subscriptionId: string) {
  return prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
    include: {
      billingAttemptLogs: {
        orderBy: { attemptedAt: "desc" },
        take: 10,
      },
      pickupSchedules: {
        orderBy: { pickupDate: "desc" },
        take: 10,
      },
    },
  });
}

/**
 * Get all subscriptions for admin list
 */
export async function getAllSubscriptions(shop: string) {
  return prisma.subscriptionPickup.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

// ============================================
// Reschedule Functions
// ============================================

/**
 * One-time reschedule: Override the next pickup date/time only
 * After the pickup is processed, returns to regular schedule
 */
export async function oneTimeReschedule(
  shop: string,
  subscriptionId: string,
  newPickupDate: Date,
  newTimeSlot: string,
  reason?: string,
  rescheduleBy: "ADMIN" | "CUSTOMER" = "ADMIN"
): Promise<void> {
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  if (subscription.status !== "ACTIVE") {
    throw new Error("Can only reschedule active subscriptions");
  }

  // Extract time slot start for billing calculation
  const timeSlotStart = extractTimeSlotStart(newTimeSlot);

  // Calculate new billing date based on the rescheduled pickup
  const newBillingDate = calculateBillingDate(
    newPickupDate,
    timeSlotStart,
    subscription.billingLeadHours
  );

  // Check if billing date is in the past
  const now = getNowInPacific();
  if (newBillingDate < now) {
    throw new Error(
      `Cannot reschedule: billing would need to happen ${formatDateISOPacific(newBillingDate)}, which is in the past. ` +
      `Please choose a pickup date at least ${subscription.billingLeadHours} hours from now.`
    );
  }

  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      // Store the one-time override
      oneTimeRescheduleDate: newPickupDate,
      oneTimeRescheduleTimeSlot: newTimeSlot,
      oneTimeRescheduleReason: reason || null,
      oneTimeRescheduleBy: rescheduleBy,
      oneTimeRescheduleAt: new Date(),
      // Also update the next pickup/billing dates
      nextPickupDate: newPickupDate,
      nextBillingDate: newBillingDate,
    },
  });

  // Update any existing pending PickupSchedule for this subscription
  // This handles the case where billing already happened but pickup hasn't
  await updatePendingPickupSchedule(shop, subscriptionId, newPickupDate, newTimeSlot);

  console.log(
    `One-time reschedule for subscription ${subscriptionId}: ` +
    `${formatDateISOPacific(newPickupDate)} at ${newTimeSlot} by ${rescheduleBy}`
  );
}

/**
 * Permanent reschedule: Change the preferred day/time slot going forward
 * This updates the regular schedule, not just the next pickup
 */
export async function permanentReschedule(
  shop: string,
  subscriptionId: string,
  newPreferredDay: number,
  newTimeSlot: string,
  reason?: string,
  rescheduleBy: "ADMIN" | "CUSTOMER" = "ADMIN"
): Promise<void> {
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  if (subscription.status === "CANCELLED") {
    throw new Error("Cannot reschedule a cancelled subscription");
  }

  // Validate day of week
  if (newPreferredDay < 0 || newPreferredDay > 6) {
    throw new Error("Invalid preferred day. Must be 0 (Sunday) through 6 (Saturday).");
  }

  // Extract time slot start
  const timeSlotStart = extractTimeSlotStart(newTimeSlot);

  // Calculate next pickup date based on new preferred day
  const nextPickupDate = calculateNextPickupDateFromToday(
    newPreferredDay,
    subscription.frequency
  );

  // Calculate billing date
  const nextBillingDate = calculateBillingDate(
    nextPickupDate,
    timeSlotStart,
    subscription.billingLeadHours
  );

  // Clear any one-time reschedule since we're doing a permanent change
  await prisma.subscriptionPickup.update({
    where: { id: subscriptionId },
    data: {
      preferredDay: newPreferredDay,
      preferredTimeSlot: newTimeSlot,
      preferredTimeSlotStart: timeSlotStart,
      nextPickupDate,
      nextBillingDate,
      // Clear one-time reschedule fields
      oneTimeRescheduleDate: null,
      oneTimeRescheduleTimeSlot: null,
      oneTimeRescheduleReason: null,
      oneTimeRescheduleBy: null,
      oneTimeRescheduleAt: null,
      // Add note about the permanent change
      adminNotes: subscription.adminNotes
        ? `${subscription.adminNotes}\n\n[${new Date().toISOString()}] Permanent reschedule by ${rescheduleBy}: Changed to ${getDayName(newPreferredDay)} at ${newTimeSlot}${reason ? ` - ${reason}` : ""}`
        : `[${new Date().toISOString()}] Permanent reschedule by ${rescheduleBy}: Changed to ${getDayName(newPreferredDay)} at ${newTimeSlot}${reason ? ` - ${reason}` : ""}`,
    },
  });

  // Update any existing pending PickupSchedule for this subscription
  // This handles the case where billing already happened but pickup hasn't
  await updatePendingPickupSchedule(shop, subscriptionId, nextPickupDate, newTimeSlot);

  console.log(
    `Permanent reschedule for subscription ${subscriptionId}: ` +
    `${getDayName(newPreferredDay)} at ${newTimeSlot} by ${rescheduleBy}`
  );
}

/**
 * Clear a one-time reschedule and revert to regular schedule
 */
export async function clearOneTimeReschedule(
  shop: string,
  subscriptionId: string
): Promise<void> {
  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { id: subscriptionId, shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  if (!subscription.oneTimeRescheduleDate) {
    throw new Error("No one-time reschedule to clear");
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
    },
  });

  console.log(`Cleared one-time reschedule for subscription ${subscriptionId}`);
}

/**
 * Check if a subscription has a one-time reschedule pending
 */
export function hasOneTimeReschedule(subscription: {
  oneTimeRescheduleDate: Date | null;
}): boolean {
  return subscription.oneTimeRescheduleDate !== null;
}

/**
 * Get available pickup days for rescheduling
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
 * Get available time slots for a specific day
 */
export async function getAvailableTimeSlots(
  shop: string,
  dayOfWeek?: number
): Promise<Array<{ label: string; startTime: string }>> {
  const where: {
    shop: string;
    isActive: boolean;
    OR?: Array<{ dayOfWeek: null } | { dayOfWeek: number }>;
  } = {
    shop,
    isActive: true,
  };

  // If day is specified, get slots for that day or global slots
  if (dayOfWeek !== undefined) {
    where.OR = [{ dayOfWeek: null }, { dayOfWeek }];
  }

  const timeSlots = await prisma.timeSlot.findMany({
    where,
    orderBy: { sortOrder: "asc" },
  });

  return timeSlots.map((slot) => ({
    label: slot.label,
    startTime: slot.startTime,
  }));
}

/**
 * Helper: Get day name from day number
 */
function getDayName(dayNum: number): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[dayNum] || "Unknown";
}

/**
 * Helper: Update any pending PickupSchedule records when a subscription is rescheduled
 * This handles the case where billing has already occurred but the pickup hasn't happened yet
 */
async function updatePendingPickupSchedule(
  shop: string,
  subscriptionId: string,
  newPickupDate: Date,
  newTimeSlot: string
): Promise<void> {
  // Find pending pickup schedules for this subscription
  // Only update SCHEDULED ones (not READY, PICKED_UP, CANCELLED, or NO_SHOW)
  const pendingPickups = await prisma.pickupSchedule.findMany({
    where: {
      shop,
      subscriptionPickupId: subscriptionId,
      pickupStatus: "SCHEDULED",
    },
    orderBy: {
      pickupDate: "desc",
    },
    take: 1, // Only the most recent pending one
  });

  if (pendingPickups.length === 0) {
    console.log(`No pending pickup schedules to update for subscription ${subscriptionId}`);
    return;
  }

  const pendingPickup = pendingPickups[0];
  console.log(
    `Updating pickup schedule ${pendingPickup.id} from ${formatDateISOPacific(pendingPickup.pickupDate)} to ${formatDateISOPacific(newPickupDate)}`
  );

  // Update the pickup schedule with new date and time slot
  await prisma.pickupSchedule.update({
    where: { id: pendingPickup.id },
    data: {
      pickupDate: newPickupDate,
      pickupTimeSlot: newTimeSlot,
      notes: pendingPickup.notes
        ? `${pendingPickup.notes}\n[Rescheduled: ${new Date().toISOString()}]`
        : `[Rescheduled: ${new Date().toISOString()}]`,
    },
  });

  // Update Google Calendar event if one exists
  if (pendingPickup.googleEventId) {
    try {
      const updated = await updatePickupEventDateTime(shop, pendingPickup.id);
      if (updated) {
        console.log(`Updated Google Calendar event for pickup ${pendingPickup.id}`);
      } else {
        console.log(`Failed to update Google Calendar event for pickup ${pendingPickup.id}`);
      }
    } catch (error) {
      console.error(`Error updating Google Calendar event for pickup ${pendingPickup.id}:`, error);
      // Don't throw - calendar update failure shouldn't block the reschedule
    }
  }
}
