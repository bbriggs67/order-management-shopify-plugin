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
  const attributes = order.note_attributes || [];
  console.log(`Found ${attributes.length} note_attributes`);

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

  console.log(`Extracted pickup info - Date: ${pickupDateRaw}, Time: ${pickupTimeSlot}, Location: ${pickupLocationId}`);

  // Check if this is a subscription order
  const subscriptionLineItem = order.line_items.find(
    (item) => item.selling_plan_allocation?.selling_plan
  );

  // If no pickup date/time AND not a subscription, skip processing
  if (!pickupDateRaw || !pickupTimeSlot) {
    // Even without pickup info, create subscription record if this is a subscription order
    if (subscriptionLineItem) {
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

        const sellingPlanName = subscriptionLineItem.selling_plan_allocation?.selling_plan.name || "";
        console.log(`Detected subscription with selling plan: ${sellingPlanName}`);

        // Determine frequency from selling plan name
        let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY" = "WEEKLY";
        if (sellingPlanName.toLowerCase().includes("every 2 weeks") ||
            sellingPlanName.toLowerCase().includes("bi-weekly") ||
            sellingPlanName.toLowerCase().includes("biweekly")) {
          frequency = "BIWEEKLY";
        } else if (sellingPlanName.toLowerCase().includes("every 3 weeks") ||
                   sellingPlanName.toLowerCase().includes("tri-weekly") ||
                   sellingPlanName.toLowerCase().includes("triweekly")) {
          frequency = "TRIWEEKLY";
        }

        // Default preferred day to current day if no pickup date
        const preferredDay = new Date().getDay();

        // Create subscription record
        const subscriptionId = await createSubscriptionFromOrder(
          shop,
          order.admin_graphql_api_id,
          customerName,
          customerEmail,
          customerPhone,
          frequency,
          preferredDay,
          "TBD", // Pickup time slot to be determined
          subscriptionLineItem.title
        );

        console.log(`Created subscription ${subscriptionId} from order ${order.name} (no pickup info)`);
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

    return json({ message: subscriptionLineItem ? "Subscription created (no pickup info)" : "No pickup info" });
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
    const dateWithYear = `${pickupDateRaw}, ${currentYear}`;
    pickupDate = new Date(dateWithYear);

    if (isNaN(pickupDate.getTime())) {
      // Try removing day name: "February 25" from "Wednesday, February 25"
      const withoutDayName = pickupDateRaw.replace(/^[A-Za-z]+,\s*/, "");
      pickupDate = new Date(`${withoutDayName}, ${currentYear}`);
    }

    if (isNaN(pickupDate.getTime())) {
      console.error(`Could not parse pickup date: ${pickupDateRaw}`);
      return json({ error: "Invalid pickup date" }, { status: 400 });
    }

    // If the parsed date is more than 7 days in the past, assume it's for next year
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (pickupDate < weekAgo) {
      pickupDate.setFullYear(currentYear + 1);
      console.log(`Date was in the past, adjusted to next year: ${pickupDate}`);
    }
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
    const subscriptionLineItem = order.line_items.find(
      (item) => item.selling_plan_allocation?.selling_plan
    );

    if (subscriptionLineItem) {
      try {
        const sellingPlanName = subscriptionLineItem.selling_plan_allocation?.selling_plan.name || "";
        console.log(`Detected subscription order with selling plan: ${sellingPlanName}`);

        // Determine frequency from selling plan name
        let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY" = "WEEKLY";
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
        const preferredDay = pickupDate.getDay();

        // Create subscription record from order
        const subscriptionId = await createSubscriptionFromOrder(
          shop,
          order.admin_graphql_api_id,
          customerName,
          customerEmail,
          customerPhone,
          frequency,
          preferredDay,
          pickupTimeSlot,
          subscriptionLineItem.title
        );

        console.log(`Created subscription ${subscriptionId} from order ${order.name}`);

        // Link the pickup schedule to the subscription
        await prisma.pickupSchedule.update({
          where: { id: pickupSchedule.id },
          data: { subscriptionPickupId: subscriptionId },
        });
        console.log(`Linked pickup schedule ${pickupSchedule.id} to subscription ${subscriptionId}`);
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
