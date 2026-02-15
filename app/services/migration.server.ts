/**
 * Migration Service
 * Handles importing existing orders and subscriptions into SSMA
 * Used for transitioning from Bird/Shopify Subscriptions to SSMA
 */

import prisma from "../db.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { createPickupEvent } from "./google-calendar.server";

// Types for Shopify API responses
interface ShopifyOrder {
  id: string; // GraphQL GID
  legacyResourceId: string;
  name: string;
  email: string;
  phone?: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  cancelledAt?: string;
  note?: string;
  customAttributes: Array<{
    key: string;
    value: string;
  }>;
  customer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  lineItems: {
    nodes: Array<{
      id: string;
      name: string;
      quantity: number;
      variant?: {
        id: string;
        title: string;
        product: {
          id: string;
          title: string;
        };
      };
      sellingPlan?: {
        sellingPlanId: string;
        name: string;
      };
    }>;
  };
  billingAddress?: {
    firstName: string;
    lastName: string;
    phone?: string;
  };
  shippingAddress?: {
    firstName: string;
    lastName: string;
    phone?: string;
  };
}

interface ShopifySubscriptionContract {
  id: string; // GraphQL GID
  status: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  deliveryPolicy: {
    interval: string;
    intervalCount: number;
  };
  billingPolicy: {
    interval: string;
    intervalCount: number;
  };
  lines: {
    nodes: Array<{
      id: string;
      productId: string;
      variantId: string;
      title: string;
      quantity: number;
    }>;
  };
  nextBillingDate?: string;
  customAttributes: Array<{
    key: string;
    value: string;
  }>;
}

interface MigrationResult {
  success: boolean;
  ordersImported: number;
  ordersSkipped: number;
  subscriptionsImported: number;
  subscriptionsSkipped: number;
  errors: string[];
  details: {
    orders: Array<{ id: string; name: string; status: "imported" | "skipped" | "error"; reason?: string }>;
    subscriptions: Array<{ id: string; customer: string; status: "imported" | "skipped" | "error"; reason?: string }>;
  };
}

/**
 * Fetch active/unfulfilled orders from Shopify
 * These are orders that haven't been picked up yet
 */
export async function fetchActiveOrders(
  admin: AdminApiContext,
  daysBack: number = 30
): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  // Calculate date range
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString();

  while (hasNextPage) {
    const response = await admin.graphql(`
      query getActiveOrders($cursor: String, $since: DateTime!) {
        orders(
          first: 50
          after: $cursor
          query: "created_at:>='${sinceStr}' AND fulfillment_status:unfulfilled AND financial_status:paid"
          sortKey: CREATED_AT
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            legacyResourceId
            name
            email
            phone
            createdAt
            displayFulfillmentStatus
            displayFinancialStatus
            cancelledAt
            note
            customAttributes {
              key
              value
            }
            customer {
              id
              firstName
              lastName
              email
              phone
            }
            lineItems(first: 50) {
              nodes {
                id
                name
                quantity
                variant {
                  id
                  title
                  product {
                    id
                    title
                  }
                }
                sellingPlan {
                  sellingPlanId
                  name
                }
              }
            }
            billingAddress {
              firstName
              lastName
              phone
            }
            shippingAddress {
              firstName
              lastName
              phone
            }
          }
        }
      }
    `, {
      variables: { cursor, since: sinceStr },
    });

    const data = await response.json();
    const ordersData = data.data?.orders;

    if (ordersData?.nodes) {
      orders.push(...ordersData.nodes);
    }

    hasNextPage = ordersData?.pageInfo?.hasNextPage ?? false;
    cursor = ordersData?.pageInfo?.endCursor ?? null;
  }

  return orders;
}

/**
 * Fetch active subscription contracts from Shopify
 */
export async function fetchActiveSubscriptions(
  admin: AdminApiContext
): Promise<ShopifySubscriptionContract[]> {
  const subscriptions: ShopifySubscriptionContract[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const response = await admin.graphql(`
      query getActiveSubscriptions($cursor: String) {
        subscriptionContracts(first: 50, after: $cursor, query: "status:ACTIVE") {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            status
            customer {
              id
              firstName
              lastName
              email
              phone
            }
            deliveryPolicy {
              interval
              intervalCount
            }
            billingPolicy {
              interval
              intervalCount
            }
            lines(first: 10) {
              nodes {
                id
                productId
                variantId
                title
                quantity
              }
            }
            nextBillingDate
            customAttributes {
              key
              value
            }
          }
        }
      }
    `, {
      variables: { cursor },
    });

    const data = await response.json();
    const contractsData = data.data?.subscriptionContracts;

    if (contractsData?.nodes) {
      subscriptions.push(...contractsData.nodes);
    }

    hasNextPage = contractsData?.pageInfo?.hasNextPage ?? false;
    cursor = contractsData?.pageInfo?.endCursor ?? null;
  }

  return subscriptions;
}

/**
 * Import a single order into SSMA
 */
async function importOrder(
  shop: string,
  order: ShopifyOrder,
  createCalendarEvent: boolean = true
): Promise<{ success: boolean; reason?: string }> {
  // Check if order already exists
  const existingPickup = await prisma.pickupSchedule.findFirst({
    where: {
      shop,
      shopifyOrderId: order.id,
    },
  });

  if (existingPickup) {
    return { success: false, reason: "Order already imported" };
  }

  // Skip cancelled orders
  if (order.cancelledAt) {
    return { success: false, reason: "Order is cancelled" };
  }

  // Extract pickup info from custom attributes
  // Support both Bird and SSMA attribute formats
  const getAttr = (key: string) =>
    order.customAttributes.find((a) =>
      a.key === key ||
      a.key.toLowerCase() === key.toLowerCase()
    )?.value || null;

  // Try different attribute names used by Bird and SSMA
  const pickupDateRaw =
    getAttr("Pickup Date") ||
    getAttr("pickup_date") ||
    getAttr("Delivery Date") ||
    getAttr("delivery_date");

  const pickupTimeSlot =
    getAttr("Pickup Time Slot") ||
    getAttr("pickup_time_slot") ||
    getAttr("Pickup Time") ||
    getAttr("pickup_time") ||
    getAttr("Delivery Time") ||
    getAttr("delivery_time");

  const pickupLocationId =
    getAttr("Pickup Location ID") ||
    getAttr("pickup_location_id");

  // If no pickup info, we can still import but set a default date
  let pickupDate: Date;

  if (pickupDateRaw) {
    pickupDate = parsePickupDate(pickupDateRaw);
  } else {
    // Default to order creation date if no pickup date specified
    pickupDate = new Date(order.createdAt);
    console.log(`Order ${order.name}: No pickup date found, using order date`);
  }

  // Get customer info
  const customerName = order.customer
    ? `${order.customer.firstName} ${order.customer.lastName}`.trim()
    : order.billingAddress
      ? `${order.billingAddress.firstName} ${order.billingAddress.lastName}`.trim()
      : "Guest";

  const customerEmail = order.email || order.customer?.email || null;
  const customerPhone =
    order.customer?.phone ||
    order.billingAddress?.phone ||
    order.shippingAddress?.phone ||
    order.phone ||
    null;

  try {
    // Create the pickup schedule
    const pickupSchedule = await prisma.pickupSchedule.create({
      data: {
        shop,
        shopifyOrderId: order.id,
        shopifyOrderNumber: order.name,
        customerName,
        customerEmail,
        customerPhone,
        pickupDate,
        pickupTimeSlot: pickupTimeSlot || "12:00 PM - 2:00 PM", // Default time slot
        pickupStatus: "SCHEDULED",
        pickupLocationId: pickupLocationId || undefined,
        orderItems: {
          create: order.lineItems.nodes.map((item) => ({
            shopifyProductId: item.variant?.product.id || item.id,
            shopifyVariantId: item.variant?.id,
            productTitle: item.variant?.product.title || item.name,
            variantTitle: item.variant?.title,
            quantity: item.quantity,
            prepDays: 0,
          })),
        },
      },
    });

    // Create Google Calendar event if enabled
    if (createCalendarEvent) {
      try {
        await createPickupEvent(shop, pickupSchedule.id);
      } catch (error) {
        console.error(`Failed to create calendar event for order ${order.name}:`, error);
        // Continue even if calendar event fails
      }
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to import order ${order.name}:`, error);
    return { success: false, reason: errorMessage };
  }
}

/**
 * Import a single subscription into SSMA
 */
async function importSubscription(
  shop: string,
  contract: ShopifySubscriptionContract
): Promise<{ success: boolean; reason?: string }> {
  // Check if subscription already exists
  const existingSubscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      shopifyContractId: contract.id,
    },
  });

  if (existingSubscription) {
    return { success: false, reason: "Subscription already imported" };
  }

  // Skip non-active subscriptions
  if (contract.status !== "ACTIVE") {
    return { success: false, reason: `Subscription status is ${contract.status}` };
  }

  // Determine frequency from billing policy
  let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";
  let discountPercent: number;

  switch (contract.billingPolicy.intervalCount) {
    case 1:
      frequency = "WEEKLY";
      discountPercent = 10;
      break;
    case 2:
      frequency = "BIWEEKLY";
      discountPercent = 5;
      break;
    case 3:
      frequency = "TRIWEEKLY";
      discountPercent = 2;
      break;
    default:
      frequency = "WEEKLY";
      discountPercent = 10;
      console.warn(`Unknown interval count: ${contract.billingPolicy.intervalCount}, defaulting to WEEKLY`);
  }

  // Extract preferred day and time from attributes
  const getAttr = (key: string) =>
    contract.customAttributes.find((a) =>
      a.key === key ||
      a.key.toLowerCase() === key.toLowerCase()
    )?.value || null;

  const preferredDayStr =
    getAttr("Subscription Preferred Day") ||
    getAttr("preferred_day") ||
    getAttr("Preferred Day");

  const preferredTimeSlot =
    getAttr("Subscription Preferred Time Slot") ||
    getAttr("preferred_time_slot") ||
    getAttr("Preferred Time") ||
    "12:00 PM - 2:00 PM";

  // Default to Tuesday (2) if not specified
  const preferredDay = preferredDayStr ? parseInt(preferredDayStr, 10) : 2;

  // Calculate next pickup date based on preferred day
  const nextPickupDate = calculateNextPickupDate(preferredDay, frequency);

  // Calculate next billing date (default 84 hours before pickup)
  const nextBillingDate = new Date(nextPickupDate.getTime() - 84 * 60 * 60 * 1000);

  // Get customer info
  const customerName = `${contract.customer.firstName} ${contract.customer.lastName}`.trim();
  const customerEmail = contract.customer.email || null;
  const customerPhone = contract.customer.phone || null;

  try {
    await prisma.subscriptionPickup.create({
      data: {
        shop,
        shopifyContractId: contract.id,
        customerName,
        customerEmail,
        customerPhone,
        preferredDay,
        preferredTimeSlot,
        frequency,
        discountPercent,
        nextPickupDate,
        nextBillingDate,
        status: "ACTIVE",
        billingLeadHours: 84,
        billingCycleCount: 0, // Reset for SSMA tracking
      },
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to import subscription for ${customerName}:`, error);
    return { success: false, reason: errorMessage };
  }
}

/**
 * Run full migration - import all active orders and subscriptions
 */
export async function runMigration(
  admin: AdminApiContext,
  shop: string,
  options: {
    importOrders?: boolean;
    importSubscriptions?: boolean;
    ordersDaysBack?: number;
    createCalendarEvents?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<MigrationResult> {
  const {
    importOrders = true,
    importSubscriptions = true,
    ordersDaysBack = 30,
    createCalendarEvents = true,
    dryRun = false,
  } = options;

  const result: MigrationResult = {
    success: true,
    ordersImported: 0,
    ordersSkipped: 0,
    subscriptionsImported: 0,
    subscriptionsSkipped: 0,
    errors: [],
    details: {
      orders: [],
      subscriptions: [],
    },
  };

  // Import orders
  if (importOrders) {
    console.log(`Fetching active orders from the last ${ordersDaysBack} days...`);
    const orders = await fetchActiveOrders(admin, ordersDaysBack);
    console.log(`Found ${orders.length} active orders`);

    for (const order of orders) {
      if (dryRun) {
        result.details.orders.push({
          id: order.id,
          name: order.name,
          status: "skipped",
          reason: "Dry run mode",
        });
        result.ordersSkipped++;
        continue;
      }

      const importResult = await importOrder(shop, order, createCalendarEvents);

      if (importResult.success) {
        result.ordersImported++;
        result.details.orders.push({
          id: order.id,
          name: order.name,
          status: "imported",
        });
      } else {
        result.ordersSkipped++;
        result.details.orders.push({
          id: order.id,
          name: order.name,
          status: "skipped",
          reason: importResult.reason,
        });
      }
    }
  }

  // Import subscriptions
  if (importSubscriptions) {
    console.log("Fetching active subscriptions...");
    const subscriptions = await fetchActiveSubscriptions(admin);
    console.log(`Found ${subscriptions.length} active subscriptions`);

    for (const subscription of subscriptions) {
      const customerName = `${subscription.customer.firstName} ${subscription.customer.lastName}`.trim();

      if (dryRun) {
        result.details.subscriptions.push({
          id: subscription.id,
          customer: customerName,
          status: "skipped",
          reason: "Dry run mode",
        });
        result.subscriptionsSkipped++;
        continue;
      }

      const importResult = await importSubscription(shop, subscription);

      if (importResult.success) {
        result.subscriptionsImported++;
        result.details.subscriptions.push({
          id: subscription.id,
          customer: customerName,
          status: "imported",
        });
      } else {
        result.subscriptionsSkipped++;
        result.details.subscriptions.push({
          id: subscription.id,
          customer: customerName,
          status: "skipped",
          reason: importResult.reason,
        });
      }
    }
  }

  return result;
}

/**
 * Parse pickup date from various formats
 */
function parsePickupDate(dateStr: string): Date {
  // Try ISO format with parentheses: "Friday, January 17 (2025-01-17)"
  const isoMatch = dateStr.match(/\((\d{4}-\d{2}-\d{2})\)/);
  if (isoMatch) {
    return new Date(isoMatch[1] + "T12:00:00");
  }

  // Try plain ISO: "2025-01-17"
  const plainIsoMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (plainIsoMatch) {
    return new Date(plainIsoMatch[1] + "T12:00:00");
  }

  // Try human readable: "Wednesday, February 25"
  const currentYear = new Date().getFullYear();
  let date = new Date(`${dateStr}, ${currentYear}`);

  if (isNaN(date.getTime())) {
    // Remove day name and try again
    const withoutDay = dateStr.replace(/^[A-Za-z]+,\s*/, "");
    date = new Date(`${withoutDay}, ${currentYear}`);
  }

  if (isNaN(date.getTime())) {
    // Last resort - use current date
    console.warn(`Could not parse date: ${dateStr}, using current date`);
    return new Date();
  }

  // If date is more than 7 days in the past, assume next year
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (date < weekAgo) {
    date.setFullYear(currentYear + 1);
  }

  return date;
}

/**
 * Calculate next pickup date based on preferred day and frequency
 */
function calculateNextPickupDate(
  preferredDay: number,
  frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY"
): Date {
  const now = new Date();
  const today = now.getDay();

  // Find next occurrence of preferred day
  let daysUntilPreferred = preferredDay - today;
  if (daysUntilPreferred <= 0) {
    daysUntilPreferred += 7;
  }

  const nextPickup = new Date(now);
  nextPickup.setDate(nextPickup.getDate() + daysUntilPreferred);
  nextPickup.setHours(12, 0, 0, 0);

  return nextPickup;
}

/**
 * Get migration status - how many orders/subscriptions are already in SSMA
 */
export async function getMigrationStatus(
  admin: AdminApiContext,
  shop: string
): Promise<{
  shopifyOrders: number;
  shopifySubscriptions: number;
  ssmaOrders: number;
  ssmaSubscriptions: number;
  pendingOrders: number;
  pendingSubscriptions: number;
}> {
  // Get counts from Shopify
  const [orders, subscriptions] = await Promise.all([
    fetchActiveOrders(admin, 30),
    fetchActiveSubscriptions(admin),
  ]);

  // Get counts from SSMA
  const [ssmaOrders, ssmaSubscriptions] = await Promise.all([
    prisma.pickupSchedule.count({
      where: {
        shop,
        pickupStatus: { in: ["SCHEDULED", "READY"] },
      },
    }),
    prisma.subscriptionPickup.count({
      where: {
        shop,
        status: "ACTIVE",
      },
    }),
  ]);

  return {
    shopifyOrders: orders.length,
    shopifySubscriptions: subscriptions.length,
    ssmaOrders,
    ssmaSubscriptions,
    pendingOrders: Math.max(0, orders.length - ssmaOrders),
    pendingSubscriptions: Math.max(0, subscriptions.length - ssmaSubscriptions),
  };
}
