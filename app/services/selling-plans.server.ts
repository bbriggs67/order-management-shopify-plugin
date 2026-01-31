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
  SellingPlanConfig,
} from "../types/selling-plans";

// Import types for internal use
import type {
  SellingPlanDetail,
  SellingPlanGroupDetail,
} from "../types/selling-plans";

export interface SellingPlanInfo {
  groupId: string;
  groupName: string;
  weeklyPlanId: string | null;
  biweeklyPlanId: string | null;
  weeklyDiscount: number;
  biweeklyDiscount: number;
}

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

// ============================================
// Service Functions
// ============================================

/**
 * Get or create the Subscribe & Save selling plan group
 */
export async function ensureSellingPlanGroup(
  shop: string,
  admin: AdminClient
): Promise<SellingPlanInfo> {
  // Check if we already have a config stored
  const existingConfig = await prisma.sellingPlanConfig.findUnique({
    where: { shop },
  });

  if (existingConfig) {
    return {
      groupId: existingConfig.sellingPlanGroupId,
      groupName: "Subscribe & Save",
      weeklyPlanId: existingConfig.weeklySellingPlanId,
      biweeklyPlanId: existingConfig.biweeklySellingPlanId,
      weeklyDiscount: existingConfig.weeklyDiscount,
      biweeklyDiscount: existingConfig.biweeklyDiscount,
    };
  }

  // Check Shopify for existing selling plan group
  const existingGroup = await findExistingSellingPlanGroup(admin);
  if (existingGroup) {
    // Store in our database
    await prisma.sellingPlanConfig.create({
      data: {
        shop,
        sellingPlanGroupId: existingGroup.groupId,
        weeklySellingPlanId: existingGroup.weeklyPlanId,
        biweeklySellingPlanId: existingGroup.biweeklyPlanId,
        weeklyDiscount: existingGroup.weeklyDiscount,
        biweeklyDiscount: existingGroup.biweeklyDiscount,
      },
    });
    return existingGroup;
  }

  // Create new selling plan group
  return createSellingPlanGroup(shop, admin);
}

/**
 * Find existing Subscribe & Save selling plan group in Shopify
 */
async function findExistingSellingPlanGroup(
  admin: AdminClient
): Promise<SellingPlanInfo | null> {
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
    return null;
  }

  const plans = subscribeGroup.node.sellingPlans.edges;
  let weeklyPlanId: string | null = null;
  let biweeklyPlanId: string | null = null;

  for (const plan of plans) {
    const policy = plan.node.billingPolicy;
    if (policy.interval === "WEEK" && policy.intervalCount === 1) {
      weeklyPlanId = plan.node.id;
    } else if (policy.interval === "WEEK" && policy.intervalCount === 2) {
      biweeklyPlanId = plan.node.id;
    }
  }

  return {
    groupId: subscribeGroup.node.id,
    groupName: subscribeGroup.node.name,
    weeklyPlanId,
    biweeklyPlanId,
    weeklyDiscount: 10, // Default values
    biweeklyDiscount: 5,
  };
}

/**
 * Create the Subscribe & Save selling plan group with weekly and bi-weekly plans
 */
async function createSellingPlanGroup(
  shop: string,
  admin: AdminClient,
  weeklyDiscount: number = 10,
  biweeklyDiscount: number = 5
): Promise<SellingPlanInfo> {
  const input = {
    name: "Subscribe & Save",
    merchantCode: "subscribe-save",
    options: ["Delivery frequency"],
    sellingPlansToCreate: [
      {
        name: `Deliver every week (${weeklyDiscount}% off)`,
        options: ["Weekly"],
        category: "SUBSCRIPTION",
        billingPolicy: {
          recurring: {
            interval: "WEEK",
            intervalCount: 1,
            anchors: [], // No anchor - flexible billing controlled by app
          },
        },
        deliveryPolicy: {
          recurring: {
            interval: "WEEK",
            intervalCount: 1,
            anchors: [],
          },
        },
        pricingPolicies: [
          {
            fixed: {
              adjustmentType: "PERCENTAGE",
              adjustmentValue: {
                percentage: weeklyDiscount,
              },
            },
          },
        ],
      },
      {
        name: `Deliver every 2 weeks (${biweeklyDiscount}% off)`,
        options: ["Bi-weekly"],
        category: "SUBSCRIPTION",
        billingPolicy: {
          recurring: {
            interval: "WEEK",
            intervalCount: 2,
            anchors: [],
          },
        },
        deliveryPolicy: {
          recurring: {
            interval: "WEEK",
            intervalCount: 2,
            anchors: [],
          },
        },
        pricingPolicies: [
          {
            fixed: {
              adjustmentType: "PERCENTAGE",
              adjustmentValue: {
                percentage: biweeklyDiscount,
              },
            },
          },
        ],
      },
    ],
  };

  const response = await admin.graphql(CREATE_SELLING_PLAN_GROUP_MUTATION, {
    variables: { input },
  });

  const jsonResponse = await response.json();
  const data: SellingPlanGroupCreateResponse = jsonResponse.data;

  if (data.sellingPlanGroupCreate.userErrors.length > 0) {
    const errors = data.sellingPlanGroupCreate.userErrors
      .map((e) => e.message)
      .join(", ");
    throw new Error(`Failed to create selling plan group: ${errors}`);
  }

  const group = data.sellingPlanGroupCreate.sellingPlanGroup;
  if (!group) {
    throw new Error("Failed to create selling plan group: no group returned");
  }

  // Extract plan IDs
  const plans = group.sellingPlans.edges;
  let weeklyPlanId: string | null = null;
  let biweeklyPlanId: string | null = null;

  for (const plan of plans) {
    if (plan.node.name.toLowerCase().includes("every week")) {
      weeklyPlanId = plan.node.id;
    } else if (plan.node.name.toLowerCase().includes("2 weeks")) {
      biweeklyPlanId = plan.node.id;
    }
  }

  // Store in database
  await prisma.sellingPlanConfig.create({
    data: {
      shop,
      sellingPlanGroupId: group.id,
      weeklySellingPlanId: weeklyPlanId,
      biweeklySellingPlanId: biweeklyPlanId,
      weeklyDiscount,
      biweeklyDiscount,
    },
  });

  return {
    groupId: group.id,
    groupName: group.name,
    weeklyPlanId,
    biweeklyPlanId,
    weeklyDiscount,
    biweeklyDiscount,
  };
}

/**
 * Add products to the selling plan group
 */
export async function addProductsToSellingPlanGroup(
  shop: string,
  admin: AdminClient,
  productIds: string[]
): Promise<void> {
  const config = await prisma.sellingPlanConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    throw new Error("Selling plan group not configured. Please set up subscriptions first.");
  }

  const response = await admin.graphql(ADD_PRODUCTS_TO_SELLING_PLAN_GROUP_MUTATION, {
    variables: {
      id: config.sellingPlanGroupId,
      productIds,
    },
  });

  const data: ProductAddToSellingPlanGroupResponse = await response.json().then((r: { data: ProductAddToSellingPlanGroupResponse }) => r.data);

  if (data.sellingPlanGroupAddProducts.userErrors.length > 0) {
    const errors = data.sellingPlanGroupAddProducts.userErrors
      .map((e) => e.message)
      .join(", ");
    throw new Error(`Failed to add products to selling plan group: ${errors}`);
  }
}

/**
 * Remove products from the selling plan group
 */
export async function removeProductsFromSellingPlanGroup(
  shop: string,
  admin: AdminClient,
  productIds: string[]
): Promise<void> {
  const config = await prisma.sellingPlanConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    throw new Error("Selling plan group not configured.");
  }

  const response = await admin.graphql(REMOVE_PRODUCTS_FROM_SELLING_PLAN_GROUP_MUTATION, {
    variables: {
      id: config.sellingPlanGroupId,
      productIds,
    },
  });

  const data = await response.json();

  if (data.data?.sellingPlanGroupRemoveProducts?.userErrors?.length > 0) {
    const errors = data.data.sellingPlanGroupRemoveProducts.userErrors
      .map((e: { message: string }) => e.message)
      .join(", ");
    throw new Error(`Failed to remove products: ${errors}`);
  }
}

/**
 * Get the selling plan configuration for a shop
 */
export async function getSellingPlanConfig(shop: string): Promise<SellingPlanInfo | null> {
  const config = await prisma.sellingPlanConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    return null;
  }

  return {
    groupId: config.sellingPlanGroupId,
    groupName: "Subscribe & Save",
    weeklyPlanId: config.weeklySellingPlanId,
    biweeklyPlanId: config.biweeklySellingPlanId,
    weeklyDiscount: config.weeklyDiscount,
    biweeklyDiscount: config.biweeklyDiscount,
  };
}

/**
 * Update selling plan discount percentages
 */
export async function updateSellingPlanDiscounts(
  shop: string,
  weeklyDiscount: number,
  biweeklyDiscount: number
): Promise<void> {
  await prisma.sellingPlanConfig.update({
    where: { shop },
    data: {
      weeklyDiscount,
      biweeklyDiscount,
    },
  });

  // Note: This only updates our local config.
  // To update the actual Shopify selling plans, you would need to use
  // sellingPlanGroupUpdate mutation. For now, we store the intent.
}

/**
 * Get all selling plan groups with full details from Shopify
 */
export async function getAllSellingPlanGroups(
  admin: AdminClient
): Promise<SellingPlanGroupDetail[]> {
  const response = await admin.graphql(ALL_SELLING_PLAN_GROUPS_QUERY);
  const jsonResponse = await response.json();
  const data = jsonResponse.data;

  if (!data?.sellingPlanGroups?.edges) {
    return [];
  }

  return data.sellingPlanGroups.edges.map((groupEdge: any) => {
    const group = groupEdge.node;
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
      plans,
    };
  });
}

/**
 * Add a new selling plan to an existing group
 */
export async function addSellingPlanToGroup(
  admin: AdminClient,
  groupId: string,
  planName: string,
  intervalCount: number,
  discountPercent: number,
  interval: string = "WEEK"
): Promise<{ success: boolean; error?: string; planId?: string }> {
  const sellingPlanInput = {
    name: planName,
    options: [getFrequencyLabel(interval, intervalCount)],
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

    return {
      success: true,
      planId: newPlan?.node?.id,
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
 * Helper to generate frequency label (uses shared formatting)
 */
function getFrequencyLabel(interval: string, intervalCount: number): string {
  return _formatFrequency(interval, intervalCount);
}

// Re-export formatFrequency from shared utilities for backward compatibility
export { formatFrequency } from "../utils/formatting";
