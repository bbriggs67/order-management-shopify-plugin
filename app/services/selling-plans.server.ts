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
  SellingPlanProduct,
} from "../types/selling-plans";

// Import types for internal use
import type {
  SellingPlanDetail,
  SellingPlanGroupDetail,
  SellingPlanProduct,
} from "../types/selling-plans";

export interface AdditionalPlanInfo {
  id: string;
  shopifyPlanId: string;
  name: string;
  interval: string;
  intervalCount: number;
  discount: number;
  discountType: string;
}

export interface SellingPlanInfo {
  groupId: string;
  groupName: string;
  weeklyPlanId: string | null;
  biweeklyPlanId: string | null;
  weeklyDiscount: number;
  biweeklyDiscount: number;
  additionalPlans?: AdditionalPlanInfo[];
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
    include: {
      additionalPlans: true,
    },
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
    additionalPlans: config.additionalPlans.map((plan) => ({
      id: plan.id,
      shopifyPlanId: plan.shopifyPlanId,
      name: plan.name,
      interval: plan.interval,
      intervalCount: plan.intervalCount,
      discount: plan.discount,
      discountType: plan.discountType,
    })),
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
  interval: string = "WEEK"
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

  const sellingPlanInput = {
    name: planName,
    options: [uniqueOption],
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

    // Save the new plan to our local database for fallback display
    if (planId) {
      const config = await prisma.sellingPlanConfig.findUnique({
        where: { shop },
      });

      if (config) {
        await prisma.sellingPlan.upsert({
          where: {
            configId_shopifyPlanId: {
              configId: config.id,
              shopifyPlanId: planId,
            },
          },
          create: {
            configId: config.id,
            shopifyPlanId: planId,
            name: planName,
            interval,
            intervalCount,
            discount: discountPercent,
            discountType: "PERCENTAGE",
          },
          update: {
            name: planName,
            interval,
            intervalCount,
            discount: discountPercent,
          },
        });
      }
    }

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

    // Also delete from local database
    await prisma.sellingPlan.deleteMany({
      where: { shopifyPlanId: planId },
    });

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

  // 1. Get the selling plan config (tells us which Shopify selling plan group to use)
  const config = await prisma.sellingPlanConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    // Try to ensure the selling plan group exists
    try {
      await ensureSellingPlanGroup(shop, admin);
    } catch (err) {
      return {
        success: false,
        message: "No selling plan group found and could not create one.",
        added, existing, errors: [String(err)],
      };
    }
    // Re-fetch config after creation
    const newConfig = await prisma.sellingPlanConfig.findUnique({ where: { shop } });
    if (!newConfig) {
      return { success: false, message: "Failed to create selling plan config.", added, existing, errors };
    }
    return syncSellingPlansFromSSMAWithConfig(admin, shop, newConfig.sellingPlanGroupId);
  }

  return syncSellingPlansFromSSMAWithConfig(admin, shop, config.sellingPlanGroupId);
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

  // 4. For each SSMA frequency, check if a matching Shopify selling plan exists
  for (const freq of ssmaFrequencies) {
    const matchingPlan = shopifyPlans.find(
      (p) => p.interval === freq.interval && p.intervalCount === freq.intervalCount,
    );

    if (matchingPlan) {
      existing.push(`${freq.name} (${getFrequencyLabel(freq.interval, freq.intervalCount)})`);
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

  const parts = [];
  if (added.length > 0) parts.push(`${added.length} added`);
  if (existing.length > 0) parts.push(`${existing.length} already existed`);
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
