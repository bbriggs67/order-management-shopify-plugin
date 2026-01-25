/**
 * Selling Plans Service
 * Manages Shopify Selling Plans for Subscribe & Save functionality
 */

import prisma from "../db.server";

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
  const data: SellingPlanGroupQueryResponse = await response.json().then((r: { data: SellingPlanGroupQueryResponse }) => r.data);

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

  const data: SellingPlanGroupCreateResponse = await response.json().then((r: { data: SellingPlanGroupCreateResponse }) => r.data);

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
