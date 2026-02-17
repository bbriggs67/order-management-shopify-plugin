import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createPickupEvent } from "../services/google-calendar.server";
import { createSubscriptionFromOrder } from "../services/subscription.server";
import { unauthenticated } from "../shopify.server";

// Attribute keys that match the checkout extension
const ATTR_PICKUP_DATE = "Pickup Date";
const ATTR_PICKUP_TIME = "Pickup Time Slot";
const ATTR_PICKUP_LOCATION_ID = "Pickup Location ID";

// Subscription attribute keys (set by cart page widget)
const ATTR_SUBSCRIPTION_ENABLED = "Subscription Enabled";
const ATTR_SUBSCRIPTION_FREQUENCY = "Subscription Frequency";
const ATTR_SUBSCRIPTION_PREFERRED_DAY = "Subscription Preferred Day";

interface OrderAttribute {
  name: string;  // Shopify REST API uses "name", not "key"
  value: string;
}

interface SellingPlanAllocation {
  selling_plan: {
    id: number;
    name: string;
  };
}

interface OrderLineItem {
  id: string;
  product_id: number;
  variant_id: number;
  title: string;
  variant_title: string;
  quantity: number;
  selling_plan_allocation?: SellingPlanAllocation;
}

// GraphQL response types for subscription detection
interface GraphQLSellingPlan {
  sellingPlan?: {
    id: string;
    name: string;
  };
}

interface GraphQLLineItem {
  id: string;
  title: string;
  quantity: number;
  sellingPlanAllocation?: GraphQLSellingPlan;
}

interface GraphQLOrderResponse {
  data?: {
    order?: {
      lineItems: {
        nodes: GraphQLLineItem[];
      };
    };
  };
}

interface OrderWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string; // Order number like "#1001"
  email: string;
  phone: string | null;
  note_attributes: OrderAttribute[];
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
  } | null;
  line_items: OrderLineItem[];
  billing_address?: {
    first_name: string;
    last_name: string;
    phone: string | null;
  };
  shipping_address?: {
    first_name: string;
    last_name: string;
    phone: string | null;
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("=== ORDERS/CREATE WEBHOOK RECEIVED ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Shopify Topic Header:", request.headers.get("x-shopify-topic"));
  console.log("Shopify Shop Header:", request.headers.get("x-shopify-shop-domain"));

  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Authenticated webhook: ${topic} for shop: ${shop}`);

  if (!payload || typeof payload !== "object") {
    console.error("Invalid webhook payload");
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const order = payload as unknown as OrderWebhookPayload;

  // Log the order details for debugging
  console.log(`Processing order ${order.name} (ID: ${order.id})`);
  console.log(`Order note_attributes:`, JSON.stringify(order.note_attributes));
  console.log(`Order line_items count:`, order.line_items?.length);

  // Check for idempotency - has this webhook already been processed?
  const existingEvent = await prisma.webhookEvent.findUnique({
    where: {
      shop_topic_shopifyId: {
        shop,
        topic: "orders/create",
        shopifyId: order.id.toString(),
      },
    },
  });

  if (existingEvent) {
    console.log(`Webhook already processed for order ${order.id}`);
    return json({ message: "Already processed" });
  }

  // Extract pickup attributes from the order
  // Try both note_attributes (REST API) and check for any custom attributes format
  let attributes: OrderAttribute[] = order.note_attributes || [];
  console.log(`Found ${attributes.length} note_attributes from webhook payload`);

  // WORKAROUND: Shopify webhooks intermittently omit note_attributes (known bug).
  // If we got zero attributes or are missing expected SSMA keys, re-fetch the order
  // from Shopify REST API to get the complete data.
  const hasSSMAAttrs = attributes.some((a) =>
    a.name === ATTR_SUBSCRIPTION_ENABLED || a.name === ATTR_PICKUP_DATE
  );

  if (attributes.length === 0 || !hasSSMAAttrs) {
    console.log(`note_attributes missing or incomplete in webhook payload, re-fetching order ${order.id} from Shopify REST API`);
    try {
      const { admin: restAdmin } = await unauthenticated.admin(shop);
      const refetchResponse = await restAdmin.graphql(`
        query getOrderAttributes($orderId: ID!) {
          order(id: $orderId) {
            id
            customAttributes {
              key
              value
            }
          }
        }
      `, {
        variables: {
          orderId: order.admin_graphql_api_id,
        },
      });

      const refetchData = await refetchResponse.json();
      const customAttrs = refetchData.data?.order?.customAttributes || [];
      console.log(`Re-fetched ${customAttrs.length} customAttributes from GraphQL:`, JSON.stringify(customAttrs));

      if (customAttrs.length > 0) {
        // GraphQL uses "key"/"value", convert to webhook format "name"/"value"
        attributes = customAttrs.map((a: { key: string; value: string }) => ({
          name: a.key,
          value: a.value || "",
        }));
        console.log(`Using re-fetched attributes (${attributes.length} total)`);
      } else {
        console.log(`Re-fetch also returned no attributes — order may genuinely have none`);
      }
    } catch (refetchError) {
      console.error(`Failed to re-fetch order attributes:`, refetchError);
      // Continue with whatever we have from the webhook
    }
  }

  const getAttr = (key: string) => {
    // Shopify REST API uses "name" for the attribute key, not "key"
    const attr = attributes.find((a) => a.name === key);
    if (attr) {
      console.log(`Found attribute "${key}": ${attr.value}`);
    } else {
      console.log(`Attribute "${key}" not found in note_attributes`);
    }
    return attr?.value || null;
  };

  const pickupDateRaw = getAttr(ATTR_PICKUP_DATE);
  const pickupTimeSlot = getAttr(ATTR_PICKUP_TIME);
  const pickupLocationId = getAttr(ATTR_PICKUP_LOCATION_ID);

  // Check for SSMA-owned subscription via cart attributes (primary method)
  const subscriptionEnabledAttr = getAttr(ATTR_SUBSCRIPTION_ENABLED);
  const subscriptionFrequencyAttr = getAttr(ATTR_SUBSCRIPTION_FREQUENCY);
  const subscriptionPreferredDayAttr = getAttr(ATTR_SUBSCRIPTION_PREFERRED_DAY);

  const isSSMASubscription = subscriptionEnabledAttr === "true" && subscriptionFrequencyAttr;

  console.log(`Extracted pickup info - Date: ${pickupDateRaw}, Time: ${pickupTimeSlot}, Location: ${pickupLocationId}`);
  console.log(`SSMA Subscription attributes - Enabled: ${subscriptionEnabledAttr}, Frequency: ${subscriptionFrequencyAttr}, PreferredDay: ${subscriptionPreferredDayAttr}`);

  // LEGACY: Check if this is a subscription order from REST payload (for backward compatibility with Shopify selling plans)
  let subscriptionLineItem = order.line_items.find(
    (item) => item.selling_plan_allocation?.selling_plan
  );

  // If no selling plan found in REST payload, query GraphQL to check
  // The REST webhook often doesn't include selling_plan_allocation even for subscription orders
  let graphqlSellingPlanName: string | null = null;
  if (!subscriptionLineItem) {
    try {
      console.log(`No selling plan in REST payload, querying GraphQL for order ${order.admin_graphql_api_id}`);
      const { admin } = await unauthenticated.admin(shop);

      const graphqlResponse = await admin.graphql(`
        query getOrderSellingPlans($orderId: ID!) {
          order(id: $orderId) {
            lineItems(first: 50) {
              nodes {
                id
                title
                quantity
                sellingPlanAllocation {
                  sellingPlan {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      `, {
        variables: {
          orderId: order.admin_graphql_api_id,
        },
      });

      const graphqlData: GraphQLOrderResponse = await graphqlResponse.json();
      console.log(`GraphQL response for order:`, JSON.stringify(graphqlData, null, 2));

      const graphqlLineItem = graphqlData.data?.order?.lineItems?.nodes?.find(
        (item) => item.sellingPlanAllocation?.sellingPlan
      );

      if (graphqlLineItem?.sellingPlanAllocation?.sellingPlan) {
        console.log(`Found selling plan via GraphQL: ${graphqlLineItem.sellingPlanAllocation.sellingPlan.name}`);
        graphqlSellingPlanName = graphqlLineItem.sellingPlanAllocation.sellingPlan.name;
        // Create a synthetic subscriptionLineItem for the rest of the code
        subscriptionLineItem = {
          id: graphqlLineItem.id,
          product_id: 0,
          variant_id: 0,
          title: graphqlLineItem.title,
          variant_title: "",
          quantity: graphqlLineItem.quantity,
          selling_plan_allocation: {
            selling_plan: {
              id: 0,
              name: graphqlSellingPlanName,
            },
          },
        };
      } else {
        console.log(`No selling plan found via GraphQL either - this is not a subscription order`);
      }
    } catch (graphqlError) {
      console.error(`Failed to query GraphQL for selling plan:`, graphqlError);
      // Continue without subscription detection if GraphQL fails
    }
  }

  // If no pickup date/time AND not a subscription, skip processing
  const isSubscriptionOrderEarly = isSSMASubscription || subscriptionLineItem;

  if (!pickupDateRaw || !pickupTimeSlot) {
    // Even without pickup info, create subscription record if this is a subscription order
    if (isSubscriptionOrderEarly) {
      console.log(`Order ${order.name} is a subscription order but has no pickup info - creating subscription record only`);

      try {
        const customerName = order.customer
          ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
          : order.billing_address
            ? `${order.billing_address.first_name} ${order.billing_address.last_name}`.trim()
            : "Guest";
        const customerEmail = order.email || order.customer?.email || null;
        const customerPhone =
          order.customer?.phone ||
          order.billing_address?.phone ||
          order.shipping_address?.phone ||
          order.phone ||
          null;

        let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY" = "WEEKLY";
        let preferredDay: number;
        let productTitle: string;

        if (isSSMASubscription) {
          // NEW: Use SSMA cart attributes
          console.log(`Detected SSMA subscription: ${subscriptionFrequencyAttr}`);
          frequency = subscriptionFrequencyAttr as "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";
          preferredDay = subscriptionPreferredDayAttr
            ? parseInt(subscriptionPreferredDayAttr, 10)
            : new Date().getDay();
          productTitle = order.line_items[0]?.title || "Subscription";
        } else if (subscriptionLineItem) {
          // LEGACY: Use selling plan detection
          const sellingPlanName = subscriptionLineItem.selling_plan_allocation?.selling_plan.name || "";
          console.log(`Detected legacy subscription with selling plan: ${sellingPlanName}`);

          if (sellingPlanName.toLowerCase().includes("every 2 weeks") ||
              sellingPlanName.toLowerCase().includes("bi-weekly") ||
              sellingPlanName.toLowerCase().includes("biweekly")) {
            frequency = "BIWEEKLY";
          } else if (sellingPlanName.toLowerCase().includes("every 3 weeks") ||
                     sellingPlanName.toLowerCase().includes("tri-weekly") ||
                     sellingPlanName.toLowerCase().includes("triweekly")) {
            frequency = "TRIWEEKLY";
          }

          preferredDay = new Date().getDay();
          productTitle = subscriptionLineItem.title;
        } else {
          throw new Error("Subscription detection inconsistency");
        }

        // Create subscription record
        const subscriptionId = await createSubscriptionFromOrder(
          shop,
          order.admin_graphql_api_id,
          order.name, // Order number like "#1847"
          customerName,
          customerEmail,
          customerPhone,
          frequency,
          preferredDay,
          "TBD", // Pickup time slot to be determined
          productTitle
        );

        console.log(`Created subscription ${subscriptionId} from order ${order.name} (no pickup info, method: ${isSSMASubscription ? 'SSMA attributes' : 'selling plan'})`);
      } catch (subError) {
        console.error("Failed to create subscription from order:", subError);
      }
    } else {
      console.log(`Order ${order.name} has no pickup info and is not a subscription, skipping`);
    }

    // Log the webhook for idempotency
    await prisma.webhookEvent.create({
      data: {
        shop,
        topic: "orders/create",
        shopifyId: order.id.toString(),
        payload: payload as object,
      },
    });

    return json({ message: isSubscriptionOrderEarly ? "Subscription created (no pickup info)" : "No pickup info" });
  }

  // Parse the pickup date
  // Supported formats:
  // 1. "Friday, January 17 (2025-01-17)" - with ISO date in parentheses
  // 2. "Wednesday, February 25" - day name and date without year
  // 3. "2025-01-17" - ISO date
  let pickupDate: Date;
  const isoDateMatch = pickupDateRaw.match(/\((\d{4}-\d{2}-\d{2})\)/);
  const plainIsoMatch = pickupDateRaw.match(/^(\d{4}-\d{2}-\d{2})$/);

  if (isoDateMatch) {
    // Format: "Friday, January 17 (2025-01-17)"
    pickupDate = new Date(isoDateMatch[1] + "T12:00:00");
    console.log(`Parsed date from ISO in parentheses: ${pickupDate}`);
  } else if (plainIsoMatch) {
    // Format: "2025-01-17"
    pickupDate = new Date(plainIsoMatch[1] + "T12:00:00");
    console.log(`Parsed date from plain ISO: ${pickupDate}`);
  } else {
    // Format: "Wednesday, February 25" - need to infer year
    // Try parsing with current year, and if that date is in the past, use next year
    const currentYear = new Date().getFullYear();

    // Remove day name prefix to get just "February 25"
    const withoutDayName = pickupDateRaw.replace(/^[A-Za-z]+,\s*/, "");

    // Parse the month and day, then construct with T12:00:00 to avoid timezone issues
    // (midnight UTC = previous day in Pacific time, so we use noon instead)
    let tempDate = new Date(`${withoutDayName}, ${currentYear}`);
    if (isNaN(tempDate.getTime())) {
      tempDate = new Date(`${pickupDateRaw}, ${currentYear}`);
    }

    if (isNaN(tempDate.getTime())) {
      console.error(`Could not parse pickup date: ${pickupDateRaw}`);
      return json({ error: "Invalid pickup date" }, { status: 400 });
    }

    // If the parsed date is more than 7 days in the past, assume it's for next year
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (tempDate < weekAgo) {
      tempDate.setFullYear(currentYear + 1);
      console.log(`Date was in the past, adjusted to next year: ${tempDate}`);
    }

    // Re-construct date with noon to avoid UTC midnight → Pacific previous-day issue
    const month = String(tempDate.getMonth() + 1).padStart(2, "0");
    const day = String(tempDate.getDate()).padStart(2, "0");
    const year = tempDate.getFullYear();
    pickupDate = new Date(`${year}-${month}-${day}T12:00:00`);
    console.log(`Parsed date from human-readable format: ${pickupDate}`);
  }

  // Get customer info
  const customerName = order.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
    : order.billing_address
      ? `${order.billing_address.first_name} ${order.billing_address.last_name}`.trim()
      : "Guest";

  const customerEmail = order.email || order.customer?.email || null;
  const customerPhone =
    order.customer?.phone ||
    order.billing_address?.phone ||
    order.shipping_address?.phone ||
    order.phone ||
    null;

  try {
    // Create the pickup schedule
    const pickupSchedule = await prisma.pickupSchedule.create({
      data: {
        shop,
        shopifyOrderId: order.admin_graphql_api_id,
        shopifyOrderNumber: order.name,
        customerName,
        customerEmail,
        customerPhone,
        pickupDate,
        pickupTimeSlot,
        pickupStatus: "SCHEDULED",
        pickupLocationId: pickupLocationId || undefined,
        orderItems: {
          create: order.line_items.map((item) => ({
            shopifyProductId: item.product_id.toString(),
            shopifyVariantId: item.variant_id?.toString(),
            productTitle: item.title,
            variantTitle: item.variant_title,
            quantity: item.quantity,
            prepDays: 0, // Will be calculated if needed
          })),
        },
      },
    });

    console.log(`Created pickup schedule ${pickupSchedule.id} for order ${order.name}`);

    // Create Google Calendar event if connected
    try {
      const eventId = await createPickupEvent(shop, pickupSchedule.id);
      if (eventId) {
        console.log(`Created Google Calendar event ${eventId} for pickup ${pickupSchedule.id}`);
      }
    } catch (error) {
      console.error("Failed to create Google Calendar event:", error);
      // Continue even if calendar event creation fails
    }

    // Check if this is a subscription order and create subscription record
    // PRIMARY: Use SSMA cart attributes (new system)
    // FALLBACK: Use selling plan detection (legacy/backward compatibility)
    const isSubscriptionOrder = isSSMASubscription || subscriptionLineItem;

    if (isSubscriptionOrder) {
      try {
        let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY" = "WEEKLY";
        let preferredDay: number;
        let productTitle: string;

        if (isSSMASubscription) {
          // NEW: Use SSMA cart attributes (primary method)
          console.log(`Detected SSMA subscription order via cart attributes: ${subscriptionFrequencyAttr}`);

          frequency = subscriptionFrequencyAttr as "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";

          // Get preferred day from attribute or fallback to pickup date
          preferredDay = subscriptionPreferredDayAttr
            ? parseInt(subscriptionPreferredDayAttr, 10)
            : pickupDate.getDay();

          // Use first line item title
          productTitle = order.line_items[0]?.title || "Subscription";
        } else if (subscriptionLineItem) {
          // LEGACY: Use selling plan detection (backward compatibility)
          const sellingPlanName = subscriptionLineItem.selling_plan_allocation?.selling_plan.name || "";
          console.log(`Detected legacy subscription order with selling plan: ${sellingPlanName}`);

          // Determine frequency from selling plan name
          if (sellingPlanName.toLowerCase().includes("every 2 weeks") ||
              sellingPlanName.toLowerCase().includes("bi-weekly") ||
              sellingPlanName.toLowerCase().includes("biweekly")) {
            frequency = "BIWEEKLY";
          } else if (sellingPlanName.toLowerCase().includes("every 3 weeks") ||
                     sellingPlanName.toLowerCase().includes("tri-weekly") ||
                     sellingPlanName.toLowerCase().includes("triweekly")) {
            frequency = "TRIWEEKLY";
          }

          // Get preferred day from pickup date (day of week)
          preferredDay = pickupDate.getDay();
          productTitle = subscriptionLineItem.title;
        } else {
          // This shouldn't happen, but handle gracefully
          console.error("isSubscriptionOrder is true but neither method detected subscription");
          throw new Error("Subscription detection inconsistency");
        }

        // Create subscription record from order
        const subscriptionId = await createSubscriptionFromOrder(
          shop,
          order.admin_graphql_api_id,
          order.name, // Order number like "#1847"
          customerName,
          customerEmail,
          customerPhone,
          frequency,
          preferredDay,
          pickupTimeSlot,
          productTitle
        );

        console.log(`Created subscription ${subscriptionId} from order ${order.name} (method: ${isSSMASubscription ? 'SSMA attributes' : 'selling plan'})`);

        // Link the pickup schedule to the subscription
        await prisma.pickupSchedule.update({
          where: { id: pickupSchedule.id },
          data: { subscriptionPickupId: subscriptionId },
        });
        console.log(`Linked pickup schedule ${pickupSchedule.id} to subscription ${subscriptionId}`);

        // Generate future pickup schedules (4 weeks ahead) for the subscription
        try {
          const subscription = await prisma.subscriptionPickup.findUnique({
            where: { id: subscriptionId },
          });

          if (subscription && subscription.nextPickupDate) {
            const frequencyDays = subscription.frequency === "BIWEEKLY" ? 14 : subscription.frequency === "TRIWEEKLY" ? 21 : 7;

            // Generate 4 weeks of future pickups (starting from week 1, since week 0 is the current order)
            for (let week = 1; week <= 4; week++) {
              const futurePickupDate = new Date(pickupDate);
              futurePickupDate.setDate(futurePickupDate.getDate() + (week * frequencyDays));

              // Create future pickup schedule
              const futurePickup = await prisma.pickupSchedule.create({
                data: {
                  shop,
                  shopifyOrderId: `subscription-${subscriptionId}-week${week}`,
                  shopifyOrderNumber: `${order.name}-W${week}`,
                  customerName,
                  customerEmail,
                  customerPhone,
                  pickupDate: futurePickupDate,
                  pickupTimeSlot,
                  pickupStatus: "SCHEDULED",
                  pickupLocationId: pickupLocationId || undefined,
                  subscriptionPickupId: subscriptionId,
                },
              });

              // Create Google Calendar event for future pickup
              try {
                await createPickupEvent(shop, futurePickup.id);
              } catch (calError) {
                console.error(`Failed to create calendar event for future pickup week ${week}:`, calError);
              }

              console.log(`Created future pickup ${futurePickup.id} for week ${week} on ${futurePickupDate.toISOString()}`);
            }
            console.log(`Generated 4 weeks of future pickups for subscription ${subscriptionId}`);
          }
        } catch (futureError) {
          console.error("Failed to generate future pickups:", futureError);
          // Continue even if future pickup generation fails
        }
      } catch (subError) {
        console.error("Failed to create subscription from order:", subError);
        // Continue even if subscription creation fails - the order is still valid
      }
    }

    // Log the webhook for idempotency
    await prisma.webhookEvent.create({
      data: {
        shop,
        topic: "orders/create",
        shopifyId: order.id.toString(),
        payload: payload as object,
      },
    });

    return json({ success: true, pickupScheduleId: pickupSchedule.id });
  } catch (error) {
    console.error("Error creating pickup schedule:", error);
    return json({ error: "Failed to create pickup schedule" }, { status: 500 });
  }
};
