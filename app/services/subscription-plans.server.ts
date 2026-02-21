/**
 * SSMA Subscription Plan Groups Service
 *
 * Manages plan groups, frequencies, and product associations.
 * A group (e.g., "Subscribe & Save - Porch Pick Up") contains multiple
 * frequency options and has products associated with it.
 */

import prisma from "../db.server";

// ============================================
// Types
// ============================================

export interface PlanGroupInput {
  name: string;
  billingLeadHours: number;
  isActive: boolean;
}

export interface PlanFrequencyInput {
  name: string;
  interval: string;
  intervalCount: number;
  discountPercent: number;
  discountCode?: string | null;
  isActive: boolean;
  sortOrder?: number;
}

export interface PlanProductInput {
  shopifyProductId: string;
  title: string;
  imageUrl?: string | null;
}

// Prisma-inferred types with relations
export type PlanGroupRecord = Awaited<ReturnType<typeof getPlanGroups>>[number];
export type PlanFrequencyRecord = PlanGroupRecord["frequencies"][number];
export type PlanProductRecord = PlanGroupRecord["products"][number];

// ============================================
// Plan Group CRUD
// ============================================

/** Get all plan groups for a shop (with frequencies and products) */
export async function getPlanGroups(shop: string) {
  return prisma.subscriptionPlanGroup.findMany({
    where: { shop },
    include: {
      frequencies: { orderBy: { sortOrder: "asc" } },
      products: { orderBy: { title: "asc" } },
    },
    orderBy: { sortOrder: "asc" },
  });
}

/** Get active plan groups with active frequencies only (for API/widget) */
export async function getActivePlanGroups(shop: string) {
  return prisma.subscriptionPlanGroup.findMany({
    where: { shop, isActive: true },
    include: {
      frequencies: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { intervalCount: "asc" }],
      },
      products: true,
    },
    orderBy: { sortOrder: "asc" },
  });
}

/** Create a new plan group */
export async function createPlanGroup(shop: string, input: PlanGroupInput) {
  validateGroupInput(input);
  return prisma.subscriptionPlanGroup.create({
    data: {
      shop,
      name: input.name,
      billingLeadHours: input.billingLeadHours,
      isActive: input.isActive,
    },
    include: {
      frequencies: { orderBy: { sortOrder: "asc" } },
      products: { orderBy: { title: "asc" } },
    },
  });
}

/** Update a plan group */
export async function updatePlanGroup(shop: string, groupId: string, input: Partial<PlanGroupInput>) {
  await verifyGroupOwnership(shop, groupId);
  if (input.name !== undefined || input.billingLeadHours !== undefined) {
    validateGroupInput({
      name: input.name ?? "placeholder",
      billingLeadHours: input.billingLeadHours ?? 85,
      isActive: input.isActive ?? true,
    });
  }
  return prisma.subscriptionPlanGroup.update({
    where: { id: groupId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.billingLeadHours !== undefined && { billingLeadHours: input.billingLeadHours }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    include: {
      frequencies: { orderBy: { sortOrder: "asc" } },
      products: { orderBy: { title: "asc" } },
    },
  });
}

/** Delete a plan group (cascades to frequencies and products) */
export async function deletePlanGroup(shop: string, groupId: string): Promise<void> {
  await verifyGroupOwnership(shop, groupId);
  await prisma.subscriptionPlanGroup.delete({ where: { id: groupId } });
}

// ============================================
// Frequency CRUD
// ============================================

/** Add a frequency to a group */
export async function addFrequency(shop: string, groupId: string, input: PlanFrequencyInput) {
  await verifyGroupOwnership(shop, groupId);
  validateFrequencyInput(input);

  try {
    return await prisma.subscriptionPlanFrequency.create({
      data: {
        groupId,
        name: input.name,
        interval: input.interval,
        intervalCount: input.intervalCount,
        discountPercent: input.discountPercent,
        discountCode: input.discountCode ?? null,
        isActive: input.isActive,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new Error(
        `A frequency with that interval already exists in this plan group. Use a different interval/count.`
      );
    }
    throw error;
  }
}

/** Update a frequency */
export async function updateFrequency(shop: string, frequencyId: string, input: Partial<PlanFrequencyInput>) {
  const existing = await prisma.subscriptionPlanFrequency.findFirst({
    where: { id: frequencyId },
    include: { group: { select: { shop: true } } },
  });
  if (!existing || existing.group.shop !== shop) {
    throw new Error("Frequency not found");
  }

  if (input.interval !== undefined || input.intervalCount !== undefined) {
    validateFrequencyInput({
      name: input.name ?? existing.name,
      interval: input.interval ?? existing.interval,
      intervalCount: input.intervalCount ?? existing.intervalCount,
      discountPercent: input.discountPercent ?? existing.discountPercent,
      isActive: input.isActive ?? existing.isActive,
    });
  }

  try {
    return await prisma.subscriptionPlanFrequency.update({
      where: { id: frequencyId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.interval !== undefined && { interval: input.interval }),
        ...(input.intervalCount !== undefined && { intervalCount: input.intervalCount }),
        ...(input.discountPercent !== undefined && { discountPercent: input.discountPercent }),
        ...(input.discountCode !== undefined && { discountCode: input.discountCode ?? null }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new Error(`A frequency with that interval already exists in this plan group.`);
    }
    throw error;
  }
}

/** Delete a frequency */
export async function deleteFrequency(shop: string, frequencyId: string): Promise<void> {
  const existing = await prisma.subscriptionPlanFrequency.findFirst({
    where: { id: frequencyId },
    include: { group: { select: { shop: true } } },
  });
  if (!existing || existing.group.shop !== shop) {
    throw new Error("Frequency not found");
  }
  await prisma.subscriptionPlanFrequency.delete({ where: { id: frequencyId } });
}

// ============================================
// Product CRUD
// ============================================

/** Add products to a group (from resource picker results) */
export async function addProductsToGroup(
  shop: string,
  groupId: string,
  products: PlanProductInput[]
): Promise<number> {
  await verifyGroupOwnership(shop, groupId);

  const result = await prisma.subscriptionPlanProduct.createMany({
    data: products.map((p) => ({
      groupId,
      shopifyProductId: p.shopifyProductId,
      title: p.title,
      imageUrl: p.imageUrl ?? null,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

/** Remove a product from a group */
export async function removeProductFromGroup(
  shop: string,
  groupId: string,
  productRecordId: string
): Promise<void> {
  await verifyGroupOwnership(shop, groupId);
  const existing = await prisma.subscriptionPlanProduct.findFirst({
    where: { id: productRecordId, groupId },
  });
  if (!existing) {
    throw new Error("Product not found in this plan group");
  }
  await prisma.subscriptionPlanProduct.delete({ where: { id: productRecordId } });
}

// ============================================
// Lookup Functions (for webhooks / subscription creation)
// ============================================

/** Find a frequency by interval (for webhook lookups) - returns parent group billingLeadHours */
export async function findFrequencyByInterval(
  shop: string,
  interval: string,
  intervalCount: number
) {
  return prisma.subscriptionPlanFrequency.findFirst({
    where: {
      group: { shop },
      interval,
      intervalCount,
    },
    include: { group: { select: { billingLeadHours: true } } },
  });
}

/** Find a frequency by legacy label (WEEKLY/BIWEEKLY/TRIWEEKLY) */
export async function findFrequencyByLabel(shop: string, frequencyLabel: string) {
  const mapping = mapFrequencyLabelToInterval(frequencyLabel);
  if (!mapping) return null;
  return findFrequencyByInterval(shop, mapping.interval, mapping.intervalCount);
}

// ============================================
// Default Seeding
// ============================================

/**
 * Ensure frequencies have correct sortOrder values.
 * Fixes records created before sortOrder was introduced (all stuck at 0).
 * Sets sortOrder = intervalCount - 1 so Weekly=0, Bi-Weekly=1, Tri-Weekly=2.
 * Called on settings page load alongside ensureDefaultPlanGroups.
 */
export async function ensureFrequencySortOrder(shop: string): Promise<void> {
  const groups = await prisma.subscriptionPlanGroup.findMany({
    where: { shop },
    include: { frequencies: { orderBy: { intervalCount: "asc" } } },
  });

  for (const group of groups) {
    // Check if all frequencies have sortOrder = 0 (unfixed state)
    const allZero = group.frequencies.length > 1 &&
      group.frequencies.every((f) => f.sortOrder === 0);

    if (allZero) {
      // Set sortOrder based on position (intervalCount order)
      for (let i = 0; i < group.frequencies.length; i++) {
        await prisma.subscriptionPlanFrequency.update({
          where: { id: group.frequencies[i].id },
          data: { sortOrder: i },
        });
      }
    }
  }
}

/** Ensure default plan groups exist (called on settings page load) */
export async function ensureDefaultPlanGroups(shop: string): Promise<void> {
  const existingCount = await prisma.subscriptionPlanGroup.count({ where: { shop } });
  if (existingCount > 0) return;

  await prisma.subscriptionPlanGroup.create({
    data: {
      shop,
      name: "Subscribe & Save - Porch Pick Up",
      billingLeadHours: 85,
      isActive: true,
      sortOrder: 0,
      frequencies: {
        create: [
          {
            name: "Weekly Delivery (10% off)",
            interval: "WEEK",
            intervalCount: 1,
            discountPercent: 10.0,
            discountCode: "SUBSCRIBE-WEEKLY-10",
            isActive: true,
            sortOrder: 0,
          },
          {
            name: "Bi-Weekly Delivery (5% off)",
            interval: "WEEK",
            intervalCount: 2,
            discountPercent: 5.0,
            discountCode: "SUBSCRIBE-BIWEEKLY-5",
            isActive: true,
            sortOrder: 1,
          },
          {
            name: "Tri-Weekly Delivery (2.5% off)",
            interval: "WEEK",
            intervalCount: 3,
            discountPercent: 2.5,
            discountCode: "SUBSCRIBE-TRIWEEKLY-3",
            isActive: true,
            sortOrder: 2,
          },
        ],
      },
    },
  });
}

// ============================================
// Helpers
// ============================================

function validateGroupInput(input: PlanGroupInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Plan group name is required");
  }
  if (input.billingLeadHours < 1 || input.billingLeadHours > 168) {
    throw new Error("Billing lead time must be between 1 and 168 hours");
  }
}

function validateFrequencyInput(input: PlanFrequencyInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Frequency name is required");
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
}

async function verifyGroupOwnership(shop: string, groupId: string): Promise<void> {
  const group = await prisma.subscriptionPlanGroup.findFirst({
    where: { id: groupId, shop },
  });
  if (!group) {
    throw new Error("Plan group not found");
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
