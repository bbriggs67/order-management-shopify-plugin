import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createPickupEvent } from "../services/google-calendar.server";
import { createSubscriptionFromOrder } from "../services/subscription.server";

// Attribute keys that match the checkout extension
const ATTR_PICKUP_DATE = "Pickup Date";
const ATTR_PICKUP_TIME = "Pickup Time Slot";
const ATTR_PICKUP_LOCATION_ID = "Pickup Location ID";

interface OrderAttribute {
  key: string;
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
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} for shop: ${shop}`);

  if (!payload || typeof payload !== "object") {
    console.error("Invalid webhook payload");
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const order = payload as unknown as OrderWebhookPayload;

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
  const attributes = order.note_attributes || [];
  const getAttr = (key: string) =>
    attributes.find((a) => a.key === key)?.value || null;

  const pickupDateRaw = getAttr(ATTR_PICKUP_DATE);
  const pickupTimeSlot = getAttr(ATTR_PICKUP_TIME);
  const pickupLocationId = getAttr(ATTR_PICKUP_LOCATION_ID);

  // If no pickup date/time, this order doesn't need a pickup schedule
  if (!pickupDateRaw || !pickupTimeSlot) {
    console.log(`Order ${order.name} has no pickup info, skipping`);

    // Still log the webhook for idempotency
    await prisma.webhookEvent.create({
      data: {
        shop,
        topic: "orders/create",
        shopifyId: order.id.toString(),
        payload: payload as object,
      },
    });

    return json({ message: "No pickup info" });
  }

  // Parse the pickup date (format: "Friday, January 17 (2025-01-17)")
  let pickupDate: Date;
  const dateMatch = pickupDateRaw.match(/\((\d{4}-\d{2}-\d{2})\)/);
  if (dateMatch) {
    pickupDate = new Date(dateMatch[1] + "T12:00:00");
  } else {
    // Try to parse the raw value as a date
    pickupDate = new Date(pickupDateRaw);
    if (isNaN(pickupDate.getTime())) {
      console.error(`Could not parse pickup date: ${pickupDateRaw}`);
      return json({ error: "Invalid pickup date" }, { status: 400 });
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
