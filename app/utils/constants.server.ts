/**
 * Shared Constants
 * Central location for magic numbers and configuration values
 */

// ============================================
// Day Names
// ============================================

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Get day name from day number (0 = Sunday, 6 = Saturday)
 */
export function getDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] || "Unknown";
}

// ============================================
// Billing Constants
// ============================================

/** Default billing lead time in hours (3.5 days before pickup) */
export const DEFAULT_BILLING_LEAD_HOURS = 84;

/** Minimum billing lead time in hours (1 hour before pickup) */
export const MIN_BILLING_LEAD_HOURS = 1;

/** Maximum billing lead time in hours (7 days before pickup) */
export const MAX_BILLING_LEAD_HOURS = 168;

/** Maximum number of billing failures before pausing subscription */
export const MAX_BILLING_FAILURES = 3;

// ============================================
// Scheduling Constants
// ============================================

/** Days in a week */
export const DAYS_IN_WEEK = 7;

/** Days in bi-weekly interval */
export const DAYS_IN_BIWEEKLY = 14;

// ============================================
// Subscription Frequencies
// ============================================

export const SUBSCRIPTION_FREQUENCIES = {
  WEEKLY: "WEEKLY",
  BIWEEKLY: "BIWEEKLY",
} as const;

export type SubscriptionFrequency = keyof typeof SUBSCRIPTION_FREQUENCIES;

// ============================================
// Subscription Statuses
// ============================================

export const SUBSCRIPTION_STATUSES = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  CANCELLED: "CANCELLED",
} as const;

export type SubscriptionStatus = keyof typeof SUBSCRIPTION_STATUSES;

// ============================================
// Pickup Statuses
// ============================================

export const PICKUP_STATUSES = {
  SCHEDULED: "SCHEDULED",
  READY: "READY",
  PICKED_UP: "PICKED_UP",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;

export type PickupStatus = keyof typeof PICKUP_STATUSES;

// ============================================
// Billing Statuses
// ============================================

export const BILLING_STATUSES = {
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  PENDING: "PENDING",
} as const;

export type BillingStatus = keyof typeof BILLING_STATUSES;

// ============================================
// Default Pickup Days (if not configured)
// ============================================

/** Default pickup days: Tuesday, Wednesday, Friday, Saturday */
export const DEFAULT_PICKUP_DAYS = [2, 3, 5, 6] as const;

// ============================================
// Validation Constants
// ============================================

/** Valid day of week range */
export const VALID_DAY_RANGE = { min: 0, max: 6 } as const;

/** Valid frequency values */
export const VALID_FREQUENCIES = ["WEEKLY", "BIWEEKLY"] as const;

/**
 * Validate that a day number is a valid day of week (0-6)
 */
export function isValidDayOfWeek(day: number): boolean {
  return Number.isInteger(day) && day >= VALID_DAY_RANGE.min && day <= VALID_DAY_RANGE.max;
}

/**
 * Validate that a frequency is valid
 */
export function isValidFrequency(frequency: string): frequency is SubscriptionFrequency {
  return VALID_FREQUENCIES.includes(frequency as SubscriptionFrequency);
}
