/**
 * SSMA Subscription Plans Service
 * Manages SSMA-owned subscription plans (not tied to Shopify Selling Plans)
 */

import prisma from "../db.server";
import { formatFrequency } from "../utils/formatting";

// ============================================
// Types
// ============================================

export interface SubscriptionPlanInput {
  name: string;
  interval: string;
  intervalCount: number;
  discountPercent: number;
  discountCode?: string | null;
  billingLeadHours: number;
  isActive: boolean;
  sortOrder?: number;
}

export interface SubscriptionPlanRecord {
  id: string;
  shop: string;
  name: string;
  interval: string;
  intervalCount: number;
  discountPercent: number;
  discountCode: string | null;
  billingLeadHours: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// CRUD Functions
// ============================================

/** Get all subscription plans for a shop */
export async function getSubscriptionPlans(shop: string): Promise<SubscriptionPlanRecord[]> {
  return prisma.subscriptionPlan.findMany({
    where: { shop },
    orderBy: { sortOrder: "asc" },
  });
}

/** Get only active subscription plans for a shop (for widget/API) */
export async function getActiveSubscriptionPlans(shop: string): Promise<SubscriptionPlanRecord[]> {
  return prisma.subscriptionPlan.findMany({
    where: { shop, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

/** Get a single plan by ID */
export async function getSubscriptionPlan(shop: string, planId: string): Promise<SubscriptionPlanRecord | null> {
  return prisma.subscriptionPlan.findFirst({
    where: { id: planId, shop },
  });
}

/** Create a new subscription plan */
export async function createSubscriptionPlan(
  shop: string,
  input: SubscriptionPlanInput
): Promise<SubscriptionPlanRecord> {
  validatePlanInput(input);

  try {
    return await prisma.subscriptionPlan.create({
      data: {
        shop,
        name: input.name,
        interval: input.interval,
        intervalCount: input.intervalCount,
        discountPercent: input.discountPercent,
        discountCode: input.discountCode ?? null,
        billingLeadHours: input.billingLeadHours,
        isActive: input.isActive,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new Error(
        `A plan with ${formatFrequency(input.interval, input.intervalCount)} delivery already exists for this shop. Delete it first or edit the existing plan.`
      );
    }
    throw error;
  }
}

/** Update an existing subscription plan */
export async function updateSubscriptionPlan(
  shop: string,
  planId: string,
  input: Partial<SubscriptionPlanInput>
): Promise<SubscriptionPlanRecord> {
  // Verify plan belongs to this shop
  const existing = await prisma.subscriptionPlan.findFirst({
    where: { id: planId, shop },
  });
  if (!existing) {
    throw new Error("Subscription plan not found");
  }

  // Validate any provided fields
  if (input.interval !== undefined || input.intervalCount !== undefined) {
    validatePlanInput({
      name: input.name ?? existing.name,
      interval: input.interval ?? existing.interval,
      intervalCount: input.intervalCount ?? existing.intervalCount,
      discountPercent: input.discountPercent ?? existing.discountPercent,
      billingLeadHours: input.billingLeadHours ?? existing.billingLeadHours,
      isActive: input.isActive ?? existing.isActive,
    });
  }

  try {
    return await prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.interval !== undefined && { interval: input.interval }),
        ...(input.intervalCount !== undefined && { intervalCount: input.intervalCount }),
        ...(input.discountPercent !== undefined && { discountPercent: input.discountPercent }),
        ...(input.discountCode !== undefined && { discountCode: input.discountCode ?? null }),
        ...(input.billingLeadHours !== undefined && { billingLeadHours: input.billingLeadHours }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new Error(
        `A plan with that delivery frequency already exists for this shop. Choose a different interval/count.`
      );
    }
    throw error;
  }
}

/** Delete a subscription plan */
export async function deleteSubscriptionPlan(shop: string, planId: string): Promise<void> {
  const existing = await prisma.subscriptionPlan.findFirst({
    where: { id: planId, shop },
  });
  if (!existing) {
    throw new Error("Subscription plan not found");
  }

  await prisma.subscriptionPlan.delete({
    where: { id: planId },
  });
}

/** Find a plan matching a frequency (for webhook lookups) */
export async function findPlanByFrequency(
  shop: string,
  interval: string,
  intervalCount: number
): Promise<SubscriptionPlanRecord | null> {
  return prisma.subscriptionPlan.findFirst({
    where: { shop, interval, intervalCount },
  });
}

/** Find a plan matching the legacy frequency label (WEEKLY/BIWEEKLY/TRIWEEKLY) */
export async function findPlanByFrequencyLabel(
  shop: string,
  frequencyLabel: string
): Promise<SubscriptionPlanRecord | null> {
  const mapping = mapFrequencyLabelToInterval(frequencyLabel);
  if (!mapping) return null;
  return findPlanByFrequency(shop, mapping.interval, mapping.intervalCount);
}

/** Ensure default plans exist (called on settings page load) */
export async function ensureDefaultPlans(shop: string): Promise<void> {
  const existingCount = await prisma.subscriptionPlan.count({ where: { shop } });
  if (existingCount > 0) return;

  const defaults = [
    {
      name: "Weekly Delivery (10% off)",
      interval: "WEEK",
      intervalCount: 1,
      discountPercent: 10.0,
      discountCode: "SUBSCRIBE-WEEKLY-10",
      billingLeadHours: 48,
      isActive: true,
      sortOrder: 0,
    },
    {
      name: "Bi-Weekly Delivery (5% off)",
      interval: "WEEK",
      intervalCount: 2,
      discountPercent: 5.0,
      discountCode: "SUBSCRIBE-BIWEEKLY-5",
      billingLeadHours: 48,
      isActive: true,
      sortOrder: 1,
    },
    {
      name: "Tri-Weekly Delivery (2.5% off)",
      interval: "WEEK",
      intervalCount: 3,
      discountPercent: 2.5,
      discountCode: "SUBSCRIBE-TRIWEEKLY-3",
      billingLeadHours: 48,
      isActive: true,
      sortOrder: 2,
    },
  ];

  await prisma.subscriptionPlan.createMany({
    data: defaults.map((plan) => ({ shop, ...plan })),
    skipDuplicates: true,
  });
}

// ============================================
// Helpers
// ============================================

function validatePlanInput(input: SubscriptionPlanInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Plan name is required");
  }
  if (!["WEEK", "MONTH"].includes(input.interval)) {
    throw new Error("Interval must be WEEK or MONTH");
  }
  if (!Number.isInteger(input.intervalCount) || input.intervalCount < 1 || input.intervalCount > 52) {
    throw new Error("Interval count must be between 1 and 52");
  }
  if (input.discountPercent < 0 || input.discountPercent > 100) {
    throw new Error("Discount percentage must be between 0 and 100");
  }
  if (input.billingLeadHours < 1 || input.billingLeadHours > 168) {
    throw new Error("Billing lead time must be between 1 and 168 hours");
  }
}

function mapFrequencyLabelToInterval(label: string): { interval: string; intervalCount: number } | null {
  switch (label.toUpperCase()) {
    case "WEEKLY":
      return { interval: "WEEK", intervalCount: 1 };
    case "BIWEEKLY":
      return { interval: "WEEK", intervalCount: 2 };
    case "TRIWEEKLY":
      return { interval: "WEEK", intervalCount: 3 };
    default:
      return null;
  }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
