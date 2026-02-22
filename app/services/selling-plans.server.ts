/**
 * Selling Plans Service
 * Manages Shopify Selling Plans for Subscribe & Save functionality
 */

import prisma from "../db.server";
import { formatFrequency as _formatFrequency } from "../utils/formatting";

// Type for the admin GraphQL client returned by authenticate.admin()
interface AdminClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

// ============================================
// Types
// ============================================

interface SellingPlanGroupCreateResponse {
  sellingPlanGroupCreate: {
    sellingPlanGroup: {
      id: string;
      name: string;
      sellingPlans: {
        edges: Array<{
          node: {
            id: string;
            name: string;
          };
        }>;
      };
    } | null;
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

interface SellingPlanGroupQueryResponse {
  sellingPlanGroups: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        sellingPlans: {
          edges: Array<{
            node: {
              id: string;
              name: string;
              billingPolicy: {
                interval: string;
                intervalCount: number;
              };
            };
          }>;
        };
      };
    }>;
  };
}

interface ProductAddToSellingPlanGroupResponse {
  sellingPlanGroupAddProducts: {
    sellingPlanGroup: {
      id: string;
    } | null;
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

// Re-export types from shared types file
export type {
  SellingPlanDetail,
  SellingPlanGroupDetail,
  SellingPlanProduct,
} from "../types/selling-plans";

// Import types for internal use
import type {
  SellingPlanDetail,
  SellingPlanGroupDetail,
  SellingPlanProduct,
} from "../types/selling-plans";

// ============================================
// GraphQL Queries & Mutations
// ============================================

const SELLING_PLAN_GROUPS_QUERY = `
  query getSellingPlanGroups {
    sellingPlanGroups(first: 10, query: "name:Subscribe") {
      edges {
        node {
          id
          name
          sellingPlans(first: 10) {
            edges {
              node {
                id
                name
                billingPolicy {
                  ... on SellingPlanRecurringBillingPolicy {
                    interval
                    intervalCount
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const ALL_SELLING_PLAN_GROUPS_QUERY = `
  query getAllSellingPlanGroups {
    sellingPlanGroups(first: 20) {
      edges {
        node {
          id
          name
          productCount
          appId
          products(first: 50) {
            edges {
              node {
                id
                title
                featuredImage {
                  url
                  altText
                }
              }
            }
          }
          sellingPlans(first: 20) {
            edges {
              node {
                id
                name
                billingPolicy {
                  ... on SellingPlanRecurringBillingPolicy {
                    interval
                    intervalCount
                  }
                }
                pricingPolicies {
                  ... on SellingPlanFixedPricingPolicy {
                    adjustmentType
                    adjustmentValue {
                      ... on SellingPlanPricingPolicyPercentageValue {
                        percentage
                      }
                      ... on MoneyV2 {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const UPDATE_SELLING_PLAN_GROUP_NAME_MUTATION = `
  mutation updateSellingPlanGroupName($id: ID!, $name: String!) {
    sellingPlanGroupUpdate(id: $id, input: { name: $name }) {
      sellingPlanGroup {
        id
        name
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ADD_SELLING_PLAN_MUTATION = `
  mutation addSellingPlanToGroup($id: ID!, $sellingPlansToCreate: [SellingPlanInput!]!) {
    sellingPlanGroupUpdate(id: $id, input: { sellingPlansToCreate: $sellingPlansToCreate }) {
      sellingPlanGroup {
        id
        sellingPlans(first: 20) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_SELLING_PLAN_MUTATION = `
  mutation deleteSellingPlan($id: ID!, $sellingPlanIdsToDelete: [ID!]!) {
    sellingPlanGroupUpdate(id: $id, input: { sellingPlansToDelete: $sellingPlanIdsToDelete }) {
      deletedSellingPlanIds
      userErrors {
        field
        message
      }
    }
  }
`;

const SELLING_PLAN_GROUP_BY_ID_QUERY = `
  query getSellingPlanGroupById($id: ID!) {
    sellingPlanGroup(id: $id) {
      id
      name
      sellingPlans(first: 20) {
        edges {
          node {
            id
            name
            billingPolicy {
              ... on SellingPlanRecurringBillingPolicy {
                interval
                intervalCount
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_SELLING_PLAN_GROUP_MUTATION = `
  mutation createSellingPlanGroup($input: SellingPlanGroupInput!) {
    sellingPlanGroupCreate(input: $input) {
      sellingPlanGroup {
        id
        name
        sellingPlans(first: 10) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ADD_PRODUCTS_TO_SELLING_PLAN_GROUP_MUTATION = `
  mutation addProductsToSellingPlanGroup($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
      sellingPlanGroup {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const REMOVE_PRODUCTS_FROM_SELLING_PLAN_GROUP_MUTATION = `
  mutation removeProductsFromSellingPlanGroup($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
      removedProductIds
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_SELLING_PLAN_POSITIONS_MUTATION = `
  mutation updateSellingPlanPositions($id: ID!, $sellingPlansToUpdate: [SellingPlanInput!]!) {
    sellingPlanGroupUpdate(id: $id, input: { sellingPlansToUpdate: $sellingPlansToUpdate }) {
      sellingPlanGroup {
        id
        sellingPlans(first: 20) {
          edges {
            node {
              id
              name
              position
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================
// Service Functions
// ============================================

/**
 * Get the current app's ID from Shopify
 */
async function getCurrentAppId(admin: AdminClient): Promise<string | null> {
  try {
    const response = await admin.graphql(`
      query getCurrentApp {
        currentAppInstallation {
          app {
            id
          }
        }
      }
    `);
    const jsonResponse = await response.json();
    return jsonResponse.data?.currentAppInstallation?.app?.id || null;
  } catch (error) {
    console.error("Error getting current app ID:", error);
    return null;
  }
}

/**
 * Get all selling plan groups with full details from Shopify
 */
export async function getAllSellingPlanGroups(
  admin: AdminClient
): Promise<SellingPlanGroupDetail[]> {
  try {
    console.log("Fetching all selling plan groups from Shopify...");

    // Get current app ID to determine ownership
    const currentAppId = await getCurrentAppId(admin);
    console.log("Current app ID:", currentAppId);

    const response = await admin.graphql(ALL_SELLING_PLAN_GROUPS_QUERY);
    const jsonResponse = await response.json();

    // Check for GraphQL errors
    if (jsonResponse.errors) {
      console.error("GraphQL errors fetching selling plan groups:", jsonResponse.errors);
      return [];
    }

    const data = jsonResponse.data;
    console.log("Selling plan groups response:", JSON.stringify(data, null, 2));

    if (!data?.sellingPlanGroups?.edges) {
      console.log("No selling plan groups edges found in response");
      return [];
    }

    console.log(`Found ${data.sellingPlanGroups.edges.length} selling plan groups`);

  return data.sellingPlanGroups.edges.map((groupEdge: any) => {
    const group = groupEdge.node;
    const appId = group.appId || null;

    // Determine if this app owns the group
    // A group is owned by current app if appId matches
    const isOwnedByCurrentApp = currentAppId ? appId === currentAppId : false;

    console.log(`Group "${group.name}" (${group.id}) - appId: ${appId}, isOwnedByCurrentApp: ${isOwnedByCurrentApp}`);

    // Parse products
    const products: SellingPlanProduct[] = (group.products?.edges || []).map((productEdge: any) => {
      const product = productEdge.node;
      return {
        id: product.id,
        title: product.title,
        imageUrl: product.featuredImage?.url,
        imageAlt: product.featuredImage?.altText,
      };
    });

    // Parse plans
    const plans: SellingPlanDetail[] = group.sellingPlans.edges.map((planEdge: any) => {
      const plan = planEdge.node;
      const billingPolicy = plan.billingPolicy || {};
      const pricingPolicy = plan.pricingPolicies?.[0] || {};

      let discount = 0;
      let discountType = "PERCENTAGE";

      if (pricingPolicy.adjustmentValue) {
        if (pricingPolicy.adjustmentValue.percentage !== undefined) {
          discount = pricingPolicy.adjustmentValue.percentage;
          discountType = "PERCENTAGE";
        } else if (pricingPolicy.adjustmentValue.amount !== undefined) {
          discount = parseFloat(pricingPolicy.adjustmentValue.amount);
          discountType = "FIXED_AMOUNT";
        }
      }

      return {
        id: plan.id,
        name: plan.name,
        interval: billingPolicy.interval || "WEEK",
        intervalCount: billingPolicy.intervalCount || 1,
        discount,
        discountType,
        productCount: 0, // Not available at plan level
      };
    });

    return {
      id: group.id,
      name: group.name,
      productCount: group.productCount || 0,
      products,
      plans,
      appId,
      isOwnedByCurrentApp,
    };
  });
  } catch (error) {
    console.error("Error fetching selling plan groups:", error);
    return [];
  }
}

/**
 * Get selling plans in a specific group
 * Used for duplicate detection before adding new plans
 */
async function getSellingPlansInGroup(
  admin: AdminClient,
  groupId: string
): Promise<Array<{ id: string; name: string; interval: string; intervalCount: number }>> {
  const response = await admin.graphql(SELLING_PLAN_GROUP_BY_ID_QUERY, {
    variables: { id: groupId },
  });

  const jsonResponse = await response.json();
  const group = jsonResponse.data?.sellingPlanGroup;

  if (!group?.sellingPlans?.edges) {
    return [];
  }

  return group.sellingPlans.edges.map((edge: any) => {
    const plan = edge.node;
    return {
      id: plan.id,
      name: plan.name,
      interval: plan.billingPolicy?.interval || "WEEK",
      intervalCount: plan.billingPolicy?.intervalCount || 1,
    };
  });
}

/**
 * Add a new selling plan to an existing group
 * Includes duplicate detection to prevent creating plans with same interval/frequency
 */
export async function addSellingPlanToGroup(
  admin: AdminClient,
  shop: string,
  groupId: string,
  planName: string,
  intervalCount: number,
  discountPercent: number,
  interval: string = "WEEK",
  position?: number
): Promise<{ success: boolean; error?: string; planId?: string }> {
  // First, check for existing plans with the same interval/frequency to prevent duplicates
  try {
    const existingPlans = await getSellingPlansInGroup(admin, groupId);
    const duplicatePlan = existingPlans.find(
      (plan) => plan.interval === interval && plan.intervalCount === intervalCount
    );

    if (duplicatePlan) {
      return {
        success: false,
        error: `A plan with ${getFrequencyLabel(interval, intervalCount)} delivery already exists: "${duplicatePlan.name}". Please delete it first if you want to create a new one with different settings.`,
      };
    }
  } catch (error) {
    console.warn("Could not check for duplicate plans, proceeding with creation:", error);
    // Continue with creation - Shopify will reject true duplicates anyway
  }

  // Create a unique option that includes discount to avoid "duplicate options" error
  // Shopify requires each selling plan within a group to have unique options
  const uniqueOption = `${getFrequencyLabel(interval, intervalCount)} (${discountPercent}% off)`;

  const sellingPlanInput: Record<string, unknown> = {
    name: planName,
    options: [uniqueOption],
    ...(position !== undefined ? { position } : {}),
    category: "SUBSCRIPTION",
    billingPolicy: {
      recurring: {
        interval,
        intervalCount,
        anchors: [],
      },
    },
    deliveryPolicy: {
      recurring: {
        interval,
        intervalCount,
        anchors: [],
      },
    },
    pricingPolicies: [
      {
        fixed: {
          adjustmentType: "PERCENTAGE",
          adjustmentValue: {
            percentage: discountPercent,
          },
        },
      },
    ],
  };

  try {
    const response = await admin.graphql(ADD_SELLING_PLAN_MUTATION, {
      variables: {
        id: groupId,
        sellingPlansToCreate: [sellingPlanInput],
      },
    });

    const jsonResponse = await response.json();
    const data = jsonResponse.data;

    if (data?.sellingPlanGroupUpdate?.userErrors?.length > 0) {
      const errors = data.sellingPlanGroupUpdate.userErrors
        .map((e: any) => e.message)
        .join(", ");
      return { success: false, error: errors };
    }

    // Find the newly created plan
    const plans = data?.sellingPlanGroupUpdate?.sellingPlanGroup?.sellingPlans?.edges || [];
    const newPlan = plans.find((p: any) => p.node.name === planName);
    const planId = newPlan?.node?.id;

    return {
      success: true,
      planId,
    };
  } catch (error) {
    console.error("Error adding selling plan:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Delete a selling plan from a group
 */
export async function deleteSellingPlan(
  admin: AdminClient,
  shop: string,
  groupId: string,
  planId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await admin.graphql(DELETE_SELLING_PLAN_MUTATION, {
      variables: {
        id: groupId,
        sellingPlanIdsToDelete: [planId],
      },
    });

    const jsonResponse = await response.json();
    const data = jsonResponse.data;

    if (data?.sellingPlanGroupUpdate?.userErrors?.length > 0) {
      const errors = data.sellingPlanGroupUpdate.userErrors
        .map((e: any) => e.message)
        .join(", ");
      return { success: false, error: errors };
    }

    return { success: true };
  } catch (error) {
    console.error("Error deleting selling plan:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Sync Shopify Selling Plans from SSMA Subscription Plan Group frequencies.
 *
 * Compares SSMA plan group frequencies against the actual Shopify selling plans
 * in the group and creates any that are missing (matched by interval + intervalCount).
 *
 * Returns a summary of what was added/already existed.
 */
export async function syncSellingPlansFromSSMA(
  admin: AdminClient,
  shop: string,
): Promise<{ success: boolean; message: string; added: string[]; existing: string[]; errors: string[] }> {
  const added: string[] = [];
  const existing: string[] = [];
  const errors: string[] = [];

  // Find the existing Shopify selling plan group by searching for "Subscribe"
  try {
    const response = await admin.graphql(SELLING_PLAN_GROUPS_QUERY);
    const jsonResponse = await response.json();
    const data: SellingPlanGroupQueryResponse = jsonResponse.data;
    const groups = data.sellingPlanGroups.edges;
    const subscribeGroup = groups.find(
      (g) =>
        g.node.name.toLowerCase().includes("subscribe") &&
        g.node.name.toLowerCase().includes("save")
    );

    if (!subscribeGroup) {
      return {
        success: false,
        message: "No 'Subscribe & Save' selling plan group found in Shopify. Create one first from the Settings page.",
        added, existing, errors,
      };
    }

    return syncSellingPlansFromSSMAWithConfig(admin, shop, subscribeGroup.node.id);
  } catch (err) {
    return {
      success: false,
      message: `Failed to find Shopify selling plan group: ${err}`,
      added, existing, errors: [String(err)],
    };
  }
}

async function syncSellingPlansFromSSMAWithConfig(
  admin: AdminClient,
  shop: string,
  shopifyGroupId: string,
): Promise<{ success: boolean; message: string; added: string[]; existing: string[]; errors: string[] }> {
  const added: string[] = [];
  const existing: string[] = [];
  const errors: string[] = [];

  // 2. Get ALL SSMA plan group frequencies (active ones)
  const ssmaGroups = await prisma.subscriptionPlanGroup.findMany({
    where: { shop },
    include: { frequencies: { where: { isActive: true } } },
  });

  const ssmaFrequencies = ssmaGroups.flatMap((g) => g.frequencies);

  if (ssmaFrequencies.length === 0) {
    return { success: true, message: "No active SSMA frequencies to sync.", added, existing, errors };
  }

  // 2b. Sync the Shopify selling plan group name to match the SSMA plan group name
  if (ssmaGroups.length > 0) {
    const ssmaGroupName = ssmaGroups[0].name;
    try {
      await admin.graphql(UPDATE_SELLING_PLAN_GROUP_NAME_MUTATION, {
        variables: { id: shopifyGroupId, name: ssmaGroupName },
      });
      console.log(`[selling-plans] Updated Shopify selling plan group name to "${ssmaGroupName}"`);
    } catch (err) {
      console.error(`[selling-plans] Failed to update group name:`, err);
      // Non-fatal — continue with plan sync
    }
  }

  // 3. Get the current Shopify selling plans in the group
  let shopifyPlans: Array<{ id: string; name: string; interval: string; intervalCount: number }>;
  try {
    shopifyPlans = await getSellingPlansInGroup(admin, shopifyGroupId);
  } catch (err) {
    return {
      success: false,
      message: `Failed to read Shopify selling plans: ${err}`,
      added, existing, errors: [String(err)],
    };
  }

  // 4. Sort SSMA frequencies by sortOrder (then intervalCount as fallback) so position values match SSMA display order
  const sortedFrequencies = [...ssmaFrequencies].sort((a, b) => a.sortOrder - b.sortOrder || a.intervalCount - b.intervalCount);

  // 5. For each SSMA frequency, check if a matching Shopify selling plan exists
  const plansToReposition: Array<{ id: string; position: number }> = [];
  for (let i = 0; i < sortedFrequencies.length; i++) {
    const freq = sortedFrequencies[i];
    const position = i + 1; // 1-based position for Shopify

    const matchingPlan = shopifyPlans.find(
      (p) => p.interval === freq.interval && p.intervalCount === freq.intervalCount,
    );

    if (matchingPlan) {
      existing.push(`${freq.name} (${getFrequencyLabel(freq.interval, freq.intervalCount)})`);
      // Track for position update — even existing plans may need reordering
      plansToReposition.push({ id: matchingPlan.id, position });
      continue;
    }

    // Missing from Shopify — add it
    const planName = `Deliver ${getFrequencyLabel(freq.interval, freq.intervalCount).toLowerCase()} (${freq.discountPercent}% off)`;
    try {
      const result = await addSellingPlanToGroup(
        admin,
        shop,
        shopifyGroupId,
        planName,
        freq.intervalCount,
        freq.discountPercent,
        freq.interval,
        position,
      );
      if (result.success) {
        added.push(planName);
      } else {
        errors.push(`${freq.name}: ${result.error}`);
      }
    } catch (err) {
      errors.push(`${freq.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 6. Update positions of existing plans to match SSMA sort order
  if (plansToReposition.length > 0) {
    try {
      const sellingPlansToUpdate = plansToReposition.map((p) => ({
        id: p.id,
        position: p.position,
      }));
      console.log(`[selling-plans] Updating positions for ${sellingPlansToUpdate.length} existing plans:`, sellingPlansToUpdate);

      const posResponse = await admin.graphql(UPDATE_SELLING_PLAN_POSITIONS_MUTATION, {
        variables: {
          id: shopifyGroupId,
          sellingPlansToUpdate,
        },
      });

      const posData = await posResponse.json();
      if (posData.data?.sellingPlanGroupUpdate?.userErrors?.length > 0) {
        const posErrors = posData.data.sellingPlanGroupUpdate.userErrors
          .map((e: any) => e.message)
          .join(", ");
        console.error(`[selling-plans] Position update errors: ${posErrors}`);
        errors.push(`Position update: ${posErrors}`);
      } else {
        console.log(`[selling-plans] Successfully updated positions for ${plansToReposition.length} plans`);
      }
    } catch (err) {
      console.error(`[selling-plans] Failed to update positions:`, err);
      errors.push(`Position update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const parts = [];
  if (added.length > 0) parts.push(`${added.length} added`);
  if (existing.length > 0) parts.push(`${existing.length} already existed`);
  if (plansToReposition.length > 0) parts.push(`${plansToReposition.length} repositioned`);
  if (errors.length > 0) parts.push(`${errors.length} failed`);

  return {
    success: errors.length === 0,
    message: `Selling plans synced (${parts.join(", ")}).${added.length > 0 ? ` Added: ${added.join(", ")}` : ""}${errors.length > 0 ? ` Errors: ${errors.join("; ")}` : ""}`,
    added, existing, errors,
  };
}

/**
 * Helper to generate frequency label (uses shared formatting)
 */
function getFrequencyLabel(interval: string, intervalCount: number): string {
  return _formatFrequency(interval, intervalCount);
}

// Re-export formatFrequency from shared utilities for backward compatibility
export { formatFrequency } from "../utils/formatting";
