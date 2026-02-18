/**
 * Shopify Discount Codes Service
 *
 * Auto-creates, updates, and deletes Shopify discount CODES (not automatic
 * discounts) via the Admin GraphQL API.  Each SubscriptionPlanFrequency that
 * carries a `discountCode` value gets a matching code-based discount in
 * Shopify, and the resulting GID is stored back on the frequency row as
 * `shopifyDiscountId`.
 */

import prisma from "../db.server";

// Re-use the same AdminClient interface from selling-plans.server.ts
interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

// ============================================
// Types
// ============================================

interface DiscountCodeCreateResponse {
  discountCodeBasicCreate: {
    codeDiscountNode: { id: string } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

interface DiscountCodeUpdateResponse {
  discountCodeBasicUpdate: {
    codeDiscountNode: { id: string } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

interface DiscountCodeDeleteResponse {
  discountCodeDelete: {
    deletedCodeDiscountId: string | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

interface FrequencyParam {
  id: string;
  name: string;
  discountPercent: number;
  discountCode: string | null;
  interval: string;
  intervalCount: number;
}

interface GroupProduct {
  shopifyProductId: string;
}

// ============================================
// GraphQL Mutations
// ============================================

const DISCOUNT_CODE_CREATE_MUTATION = `
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DISCOUNT_CODE_UPDATE_MUTATION = `
  mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DISCOUNT_CODE_DELETE_MUTATION = `
  mutation discountCodeDelete($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================
// Helper: Generate Discount Code
// ============================================

/**
 * Generate a human-readable discount code from interval info.
 *
 * Examples:
 *   WEEK / 1  / 10%   -> SUBSCRIBE-WEEKLY-10
 *   WEEK / 2  / 5%    -> SUBSCRIBE-BIWEEKLY-5
 *   WEEK / 3  / 2.5%  -> SUBSCRIBE-TRIWEEKLY-3
 *   MONTH / 1 / 15%   -> SUBSCRIBE-MONTHLY-15
 *   MONTH / 2 / 10%   -> SUBSCRIBE-2MONTHLY-10
 */
export function generateDiscountCode(
  interval: string,
  intervalCount: number,
  discountPercent: number,
): string {
  let frequencyPart: string;

  if (interval === "WEEK") {
    switch (intervalCount) {
      case 1:
        frequencyPart = "WEEKLY";
        break;
      case 2:
        frequencyPart = "BIWEEKLY";
        break;
      case 3:
        frequencyPart = "TRIWEEKLY";
        break;
      default:
        frequencyPart = `${intervalCount}WEEKLY`;
        break;
    }
  } else if (interval === "MONTH") {
    switch (intervalCount) {
      case 1:
        frequencyPart = "MONTHLY";
        break;
      default:
        frequencyPart = `${intervalCount}MONTHLY`;
        break;
    }
  } else {
    frequencyPart = `${intervalCount}${interval}`;
  }

  // Round the discount to avoid floating point noise in the code string
  const discountPart = Number.isInteger(discountPercent)
    ? String(discountPercent)
    : String(Math.round(discountPercent));

  return `SUBSCRIBE-${frequencyPart}-${discountPart}`;
}

// ============================================
// Build the DiscountCodeBasicInput payload
// ============================================

function buildDiscountInput(
  freq: Pick<FrequencyParam, "name" | "discountPercent" | "discountCode">,
  groupProducts: GroupProduct[],
) {
  const code = freq.discountCode ?? `SSMA-${Date.now()}`;

  // Shopify percentage value is 0.0 - 1.0 (e.g. 10% -> 0.1)
  // Per the Shopify docs: positive decimal, NOT negative
  const percentage = freq.discountPercent / 100;

  const items =
    groupProducts.length > 0
      ? {
          products: {
            productsToAdd: groupProducts.map((p) => p.shopifyProductId),
          },
        }
      : { all: true };

  return {
    title: `SSMA: ${freq.name}`,
    code,
    startsAt: new Date().toISOString(),
    customerSelection: { all: true },
    customerGets: {
      value: { percentage },
      items,
    },
    combinesWith: {
      shippingDiscounts: true,
      orderDiscounts: false,
      productDiscounts: false,
    },
  };
}

// ============================================
// Service Functions
// ============================================

/**
 * Create a Shopify discount code for a given frequency and store the
 * resulting shopifyDiscountId back on the frequency row.
 */
export async function createDiscountCodeForFrequency(
  admin: AdminClient,
  freq: FrequencyParam,
  groupProducts: GroupProduct[],
): Promise<string | null> {
  // If no discount code string is set, auto-generate one
  const effectiveCode =
    freq.discountCode && freq.discountCode.trim().length > 0
      ? freq.discountCode
      : generateDiscountCode(freq.interval, freq.intervalCount, freq.discountPercent);

  const freqWithCode = { ...freq, discountCode: effectiveCode };

  try {
    const basicCodeDiscount = buildDiscountInput(freqWithCode, groupProducts);

    const response = await admin.graphql(DISCOUNT_CODE_CREATE_MUTATION, {
      variables: { basicCodeDiscount },
    });

    const jsonResponse = await response.json();
    const data: DiscountCodeCreateResponse = jsonResponse.data;

    if (data.discountCodeBasicCreate.userErrors.length > 0) {
      const errors = data.discountCodeBasicCreate.userErrors
        .map((e) => `${e.field?.join(".")}: ${e.message}`)
        .join("; ");
      console.error(`[shopify-discounts] Failed to create discount for freq ${freq.id}: ${errors}`);
      return null;
    }

    const shopifyDiscountId = data.discountCodeBasicCreate.codeDiscountNode?.id ?? null;

    if (shopifyDiscountId) {
      // Persist the Shopify GID and the effective code back to DB
      await prisma.subscriptionPlanFrequency.update({
        where: { id: freq.id },
        data: {
          shopifyDiscountId,
          discountCode: effectiveCode,
        },
      });
    }

    console.log(
      `[shopify-discounts] Created discount "${effectiveCode}" -> ${shopifyDiscountId} for freq ${freq.id}`,
    );
    return shopifyDiscountId;
  } catch (error) {
    console.error(`[shopify-discounts] Error creating discount for freq ${freq.id}:`, error);
    return null;
  }
}

/**
 * Update an existing Shopify discount code (percentage, product targeting).
 */
export async function updateDiscountCodeForFrequency(
  admin: AdminClient,
  shopifyDiscountId: string,
  freq: Pick<FrequencyParam, "discountPercent" | "discountCode" | "name">,
  groupProducts: GroupProduct[],
): Promise<boolean> {
  try {
    const basicCodeDiscount = buildDiscountInput(freq, groupProducts);

    const response = await admin.graphql(DISCOUNT_CODE_UPDATE_MUTATION, {
      variables: {
        id: shopifyDiscountId,
        basicCodeDiscount,
      },
    });

    const jsonResponse = await response.json();
    const data: DiscountCodeUpdateResponse = jsonResponse.data;

    if (data.discountCodeBasicUpdate.userErrors.length > 0) {
      const errors = data.discountCodeBasicUpdate.userErrors
        .map((e) => `${e.field?.join(".")}: ${e.message}`)
        .join("; ");
      console.error(
        `[shopify-discounts] Failed to update discount ${shopifyDiscountId}: ${errors}`,
      );
      return false;
    }

    console.log(`[shopify-discounts] Updated discount ${shopifyDiscountId}`);
    return true;
  } catch (error) {
    console.error(
      `[shopify-discounts] Error updating discount ${shopifyDiscountId}:`,
      error,
    );
    return false;
  }
}

/**
 * Delete a Shopify discount code by its GID.
 */
export async function deleteDiscountCode(
  admin: AdminClient,
  shopifyDiscountId: string,
): Promise<boolean> {
  try {
    const response = await admin.graphql(DISCOUNT_CODE_DELETE_MUTATION, {
      variables: { id: shopifyDiscountId },
    });

    const jsonResponse = await response.json();
    const data: DiscountCodeDeleteResponse = jsonResponse.data;

    if (data.discountCodeDelete.userErrors.length > 0) {
      const errors = data.discountCodeDelete.userErrors
        .map((e) => `${e.field?.join(".")}: ${e.message}`)
        .join("; ");
      console.error(
        `[shopify-discounts] Failed to delete discount ${shopifyDiscountId}: ${errors}`,
      );
      return false;
    }

    console.log(`[shopify-discounts] Deleted discount ${shopifyDiscountId}`);
    return true;
  } catch (error) {
    console.error(
      `[shopify-discounts] Error deleting discount ${shopifyDiscountId}:`,
      error,
    );
    return false;
  }
}

/**
 * Result of syncing discounts for a group.
 */
export interface DiscountSyncResult {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
  errors: string[];
}

/**
 * Sync all discount codes for a single plan group.
 *
 * - Active frequencies WITH a discountCode but WITHOUT a shopifyDiscountId -> create
 * - Active frequencies WITH a discountCode AND a shopifyDiscountId        -> update
 * - Inactive frequencies WITH a shopifyDiscountId                         -> delete & clear
 */
export async function syncDiscountsForGroup(
  admin: AdminClient,
  shop: string,
  groupId: string,
): Promise<DiscountSyncResult> {
  const result: DiscountSyncResult = { created: 0, updated: 0, deleted: 0, failed: 0, errors: [] };

  const group = await prisma.subscriptionPlanGroup.findFirst({
    where: { id: groupId, shop },
    include: {
      frequencies: true,
      products: true,
    },
  });

  if (!group) {
    console.error(`[shopify-discounts] Group ${groupId} not found for shop ${shop}`);
    result.failed++;
    result.errors.push(`Group ${groupId} not found`);
    return result;
  }

  const groupProducts: GroupProduct[] = group.products.map((p) => ({
    shopifyProductId: p.shopifyProductId,
  }));

  for (const freq of group.frequencies) {
    try {
      // Active frequency with a discount percentage should have a Shopify discount code.
      // If discountCode is null/empty but discountPercent > 0, auto-generate a code.
      const needsDiscount = freq.isActive && freq.discountPercent > 0;
      const hasCode = freq.discountCode && freq.discountCode.trim().length > 0;
      const effectiveCode = hasCode
        ? freq.discountCode!
        : needsDiscount
          ? generateDiscountCode(freq.interval, freq.intervalCount, freq.discountPercent)
          : null;

      if (needsDiscount && effectiveCode) {
        if (!freq.shopifyDiscountId) {
          // Create new discount (will auto-persist the code to DB)
          const id = await createDiscountCodeForFrequency(
            admin,
            {
              id: freq.id,
              name: freq.name,
              discountPercent: freq.discountPercent,
              discountCode: effectiveCode,
              interval: freq.interval,
              intervalCount: freq.intervalCount,
            },
            groupProducts,
          );
          if (id) {
            result.created++;
          } else {
            result.failed++;
            result.errors.push(`Failed to create discount for "${freq.name}" (${effectiveCode})`);
          }
        } else {
          // Update existing discount
          const ok = await updateDiscountCodeForFrequency(
            admin,
            freq.shopifyDiscountId,
            {
              discountPercent: freq.discountPercent,
              discountCode: effectiveCode,
              name: freq.name,
            },
            groupProducts,
          );
          if (ok) {
            result.updated++;
          } else {
            result.failed++;
            result.errors.push(`Failed to update discount for "${freq.name}" (${effectiveCode})`);
          }
        }
      } else if (!freq.isActive && freq.shopifyDiscountId) {
        // Frequency deactivated -- remove the discount from Shopify
        const deleted = await deleteDiscountCode(admin, freq.shopifyDiscountId);
        if (deleted) {
          await prisma.subscriptionPlanFrequency.update({
            where: { id: freq.id },
            data: { shopifyDiscountId: null },
          });
          result.deleted++;
        } else {
          result.failed++;
          result.errors.push(`Failed to delete discount for "${freq.name}"`);
        }
      }
    } catch (error) {
      // Log and continue -- don't let one frequency failure block the rest
      console.error(
        `[shopify-discounts] Error syncing discount for freq ${freq.id} (${freq.name}):`,
        error,
      );
      result.failed++;
      result.errors.push(`Error syncing "${freq.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

/**
 * Sync discount codes for ALL plan groups belonging to a shop.
 * Returns aggregated results across all groups.
 */
export async function syncAllDiscounts(
  admin: AdminClient,
  shop: string,
): Promise<DiscountSyncResult> {
  const totals: DiscountSyncResult = { created: 0, updated: 0, deleted: 0, failed: 0, errors: [] };

  const groups = await prisma.subscriptionPlanGroup.findMany({
    where: { shop },
    select: { id: true },
  });

  for (const group of groups) {
    const r = await syncDiscountsForGroup(admin, shop, group.id);
    totals.created += r.created;
    totals.updated += r.updated;
    totals.deleted += r.deleted;
    totals.failed += r.failed;
    totals.errors.push(...r.errors);
  }

  console.log(
    `[shopify-discounts] Finished syncing discounts for ${groups.length} group(s) in shop ${shop}: ` +
    `created=${totals.created}, updated=${totals.updated}, deleted=${totals.deleted}, failed=${totals.failed}`,
  );

  return totals;
}
