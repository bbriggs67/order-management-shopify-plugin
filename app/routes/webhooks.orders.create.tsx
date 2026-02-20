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

  // Authenticate the webhook — HMAC validation + session loading.
  // With expiringOfflineAccessTokens enabled, session token refresh may fail
  // (e.g. during Railway cold starts or token expiry edge cases).
  // We must handle this gracefully to avoid losing webhooks entirely.
  let shop: string;
  let topic: string;
  let payload: unknown;
  try {
    const authResult = await authenticate.webhook(request);
    shop = authResult.shop;
    topic = authResult.topic;
    payload = authResult.payload;
  } catch (authError) {
    console.error("=== WEBHOOK AUTHENTICATION FAILED ===");
    console.error("Error:", authError);
    // If authentication fails, we can't process the webhook securely.
    // Return 200 to prevent Shopify from retrying indefinitely if the
    // error is due to token refresh failure (not HMAC). But log it so
    // we can investigate.
    // Check if this is likely an HMAC failure vs a token refresh failure.
    const errorMsg = String(authError);
    if (errorMsg.includes("HMAC") || errorMsg.includes("signature") || errorMsg.includes("unauthorized")) {
      console.error("HMAC validation failed - rejecting webhook");
      return json({ error: "Authentication failed" }, { status: 401 });
    }
    // Token refresh failure — return 500 so Shopify retries later
    // (when the session may have been refreshed by a page load)
    console.error("Session/token error during webhook auth - returning 500 for retry");
    return json({ error: "Session error, will retry" }, { status: 500 });
  }

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

  // Check for idempotency — two layers:
  // 1. Check if a PickupSchedule already exists for this order (definitive)
  // 2. Check WebhookEvent as a secondary guard
  // NOTE: We do NOT save WebhookEvent early because Shopify sends multiple
  // concurrent webhook deliveries. If we save WebhookEvent before processing,
  // concurrent requests will pass the check, then one PickupSchedule.create
  // succeeds while others fail with unique constraint — and retries will be
  // blocked by the existing WebhookEvent.
  const existingPickup = await prisma.pickupSchedule.findFirst({
    where: {
      shop,
      shopifyOrderId: order.admin_graphql_api_id,
    },
  });

  if (existingPickup) {
    console.log(`PickupSchedule already exists for order ${order.name} (${existingPickup.id}), skipping`);
    return json({ message: "Already processed" });
  }

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
    // WebhookEvent exists but no PickupSchedule — previous attempt may have failed.
    // Allow reprocessing by continuing (don't return early).
    console.log(`WebhookEvent exists for order ${order.id} but no PickupSchedule — reprocessing`);
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
    if (!isSubscriptionOrderEarly) {
      console.log(`Order ${order.name} has no pickup info and is not a subscription, skipping`);
      // Save WebhookEvent before returning so we don't reprocess this order
      await prisma.webhookEvent.upsert({
        where: { shop_topic_shopifyId: { shop, topic: "orders/create", shopifyId: order.id.toString() } },
        update: {},
        create: { shop, topic: "orders/create", shopifyId: order.id.toString(), payload: payload as object },
      });
      return json({ message: "No pickup info" });
    }
    // For subscription orders without pickup info, continue processing below.
    // We'll use fallback date/time so the order still appears in SSMA Orders & Calendar.
    console.log(`Order ${order.name} is a subscription order with missing pickup info - will use fallback date/time`);
  }

  // Parse the pickup date
  // Supported formats:
  // 1. "Friday, January 17 (2025-01-17)" - with ISO date in parentheses
  // 2. "Wednesday, February 25" - day name and date without year
  // 3. "2025-01-17" - ISO date
  // 4. null/undefined - fallback to today (for subscription orders without pickup info)
  let pickupDate: Date;
  const effectivePickupTimeSlot = pickupTimeSlot || "TBD";

  if (!pickupDateRaw) {
    // Fallback: subscription order with no pickup date — use today at noon
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    pickupDate = new Date(`${y}-${m}-${d}T12:00:00`);
    console.log(`No pickup date provided, using today as fallback: ${pickupDate}`);
  } else {
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
      const currentYear = new Date().getFullYear();
      const withoutDayName = pickupDateRaw.replace(/^[A-Za-z]+,\s*/, "");

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
        pickupTimeSlot: effectivePickupTimeSlot,
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
    }

    // Check if this is a subscription order and create subscription record
    const isSubscriptionOrder = isSSMASubscription || subscriptionLineItem;

    if (isSubscriptionOrder) {
      try {
        let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY" = "WEEKLY";
        let preferredDay: number;
        let productTitle: string;

        if (isSSMASubscription) {
          console.log(`Detected SSMA subscription order via cart attributes: ${subscriptionFrequencyAttr}`);
          frequency = subscriptionFrequencyAttr as "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";
          preferredDay = subscriptionPreferredDayAttr
            ? parseInt(subscriptionPreferredDayAttr, 10)
            : pickupDate.getDay();
          productTitle = order.line_items[0]?.title || "Subscription";
        } else if (subscriptionLineItem) {
          const sellingPlanName = subscriptionLineItem.selling_plan_allocation?.selling_plan.name || "";
          console.log(`Detected legacy subscription order with selling plan: ${sellingPlanName}`);

          if (sellingPlanName.toLowerCase().includes("every 2 weeks") ||
              sellingPlanName.toLowerCase().includes("bi-weekly") ||
              sellingPlanName.toLowerCase().includes("biweekly")) {
            frequency = "BIWEEKLY";
          } else if (sellingPlanName.toLowerCase().includes("every 3 weeks") ||
                     sellingPlanName.toLowerCase().includes("tri-weekly") ||
                     sellingPlanName.toLowerCase().includes("triweekly")) {
            frequency = "TRIWEEKLY";
          }

          preferredDay = pickupDate.getDay();
          productTitle = subscriptionLineItem.title;
        } else {
          console.error("isSubscriptionOrder is true but neither method detected subscription");
          throw new Error("Subscription detection inconsistency");
        }

        const subscriptionId = await createSubscriptionFromOrder(
          shop,
          order.admin_graphql_api_id,
          order.name,
          customerName,
          customerEmail,
          customerPhone,
          frequency,
          preferredDay,
          effectivePickupTimeSlot,
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
            const frequencyDays = frequency === "WEEKLY" ? 7 : frequency === "TRIWEEKLY" ? 21 : 14;

            for (let week = 1; week <= 4; week++) {
              const futurePickupDate = new Date(pickupDate);
              futurePickupDate.setDate(futurePickupDate.getDate() + (week * frequencyDays));

              const futurePickup = await prisma.pickupSchedule.create({
                data: {
                  shop,
                  shopifyOrderId: `subscription-${subscriptionId}-week${week}`,
                  shopifyOrderNumber: `${order.name}-W${week}`,
                  customerName,
                  customerEmail,
                  customerPhone,
                  pickupDate: futurePickupDate,
                  pickupTimeSlot: effectivePickupTimeSlot,
                  pickupStatus: "SCHEDULED",
                  pickupLocationId: pickupLocationId || undefined,
                  subscriptionPickupId: subscriptionId,
                },
              });

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
        }
      } catch (subError) {
        console.error("Failed to create subscription from order:", subError);
      }
    }

    // Add tags to the Shopify order: time slot, pickup date, and subscription flag
    try {
      const { admin: tagAdmin } = await unauthenticated.admin(shop);

      // Format pickup date for tag — avoid commas since Shopify splits tags on commas.
      // e.g., "February 20 2026" not "February 20, 2026"
      const dateFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const dateParts = dateFormatter.formatToParts(pickupDate);
      const monthPart = dateParts.find(p => p.type === "month")?.value || "";
      const dayPart = dateParts.find(p => p.type === "day")?.value || "";
      const yearPart = dateParts.find(p => p.type === "year")?.value || "";
      const pickupDateTag = `${monthPart} ${dayPart} ${yearPart}`;

      const dayOfWeek = pickupDate.toLocaleDateString("en-US", {
        timeZone: "America/Los_Angeles",
        weekday: "long",
      });

      const tags: string[] = [
        effectivePickupTimeSlot,
        pickupDateTag,
        dayOfWeek,
      ];

      if (isSubscriptionOrder) {
        tags.push("Subscription");
      }

      await tagAdmin.graphql(`
        mutation addOrderTags($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node {
              ... on Order {
                id
                tags
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          id: order.admin_graphql_api_id,
          tags,
        },
      });

      console.log(`Added tags to order ${order.name}: ${tags.join(", ")}`);
    } catch (tagError) {
      console.error("Failed to add tags to order:", tagError);
      // Non-critical — continue even if tagging fails
    }

    // Save WebhookEvent AFTER successful processing.
    // Using upsert to handle concurrent requests gracefully.
    await prisma.webhookEvent.upsert({
      where: { shop_topic_shopifyId: { shop, topic: "orders/create", shopifyId: order.id.toString() } },
      update: {},
      create: { shop, topic: "orders/create", shopifyId: order.id.toString(), payload: payload as object },
    });
    console.log(`Saved webhook event for order ${order.name}`);

    return json({ success: true, pickupScheduleId: pickupSchedule.id });
  } catch (error) {
    // Handle race condition: if another concurrent request already created
    // the PickupSchedule (unique constraint on shop+shopifyOrderId), treat
    // as success rather than returning 500.
    const errorMsg = String(error);
    if (errorMsg.includes("Unique constraint") || errorMsg.includes("P2002")) {
      console.log(`Concurrent request already created PickupSchedule for order ${order.name}, treating as success`);
      // Still save WebhookEvent
      await prisma.webhookEvent.upsert({
        where: { shop_topic_shopifyId: { shop, topic: "orders/create", shopifyId: order.id.toString() } },
        update: {},
        create: { shop, topic: "orders/create", shopifyId: order.id.toString(), payload: payload as object },
      }).catch(() => {}); // Ignore if this also fails
      return json({ success: true, message: "Processed by concurrent request" });
    }

    console.error("Error creating pickup schedule:", error);
    // Don't save WebhookEvent on failure — allow retry
    return json({ error: "Failed to create pickup schedule" }, { status: 500 });
  }
};
