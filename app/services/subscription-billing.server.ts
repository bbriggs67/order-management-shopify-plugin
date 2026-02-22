/**
 * Subscription Billing Service
 * Handles programmatic billing 84 hours before scheduled pickups
 */

import prisma from "../db.server";
import {
  getNowInPacific,
  getDatePacific,
  formatDateISOPacific,
} from "../utils/timezone.server";
import {
  DEFAULT_BILLING_LEAD_HOURS,
  MIN_BILLING_LEAD_HOURS,
  MAX_BILLING_LEAD_HOURS,
  MAX_BILLING_FAILURES,
} from "../utils/constants";

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

  // Create pickup datetime in Pacific timezone
  // setHours() uses the server's local timezone (UTC on Railway), so we must
  // convert the pickup date to Pacific first, then set the pickup time.
  const pacificPickupStr = pickupDate.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pickupDateTime = new Date(pacificPickupStr);
  pickupDateTime.setHours(hours, minutes, 0, 0);

  // Calculate the offset between Pacific and UTC to get the correct absolute time
  const utcStr = pickupDate.toLocaleString("en-US", { timeZone: "UTC" });
  const utcDate = new Date(utcStr);
  const pacificDate = new Date(pacificPickupStr);
  const offsetMs = utcDate.getTime() - pacificDate.getTime();

  // Convert Pacific pickup time back to UTC, then subtract lead hours
  const pickupDateTimeUTC = new Date(pickupDateTime.getTime() + offsetMs);
  const billingDate = new Date(pickupDateTimeUTC.getTime() - validLeadHours * 60 * 60 * 1000);

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
  const increment = frequency === "WEEKLY" ? 7 : frequency === "TRIWEEKLY" ? 21 : 14;
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
  const idempotencyKey = `${subscription.id}-cycle-${billingCycle}`;

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

