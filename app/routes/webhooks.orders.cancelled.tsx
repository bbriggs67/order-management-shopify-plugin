import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deletePickupEvent } from "../services/google-calendar.server";

interface OrderWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string;
  cancelled_at: string | null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} for shop: ${shop}`);

  if (!payload || typeof payload !== "object") {
    console.error("Invalid webhook payload");
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const order = payload as unknown as OrderWebhookPayload;

  // Check for idempotency
  const existingEvent = await prisma.webhookEvent.findUnique({
    where: {
      shop_topic_shopifyId: {
        shop,
        topic: "orders/cancelled",
        shopifyId: order.id.toString(),
      },
    },
  });

  if (existingEvent) {
    console.log(`Webhook already processed for cancelled order ${order.id}`);
    return json({ message: "Already processed" });
  }

  try {
    // Find the pickup schedule for this order (include subscription link)
    const pickup = await prisma.pickupSchedule.findFirst({
      where: {
        shop,
        shopifyOrderId: order.admin_graphql_api_id,
      },
      select: {
        id: true,
        subscriptionPickupId: true,
      },
    });

    if (pickup) {
      // Update pickup status to cancelled
      await prisma.pickupSchedule.update({
        where: { id: pickup.id },
        data: { pickupStatus: "CANCELLED" },
      });

      console.log(`Cancelled pickup schedule ${pickup.id} for order ${order.name}`);

      // If this pickup is linked to a subscription, also update the subscription
      if (pickup.subscriptionPickupId) {
        await prisma.subscriptionPickup.update({
          where: { id: pickup.subscriptionPickupId },
          data: { status: "CANCELLED" },
        });
        console.log(`Cancelled subscription ${pickup.subscriptionPickupId} due to order cancellation`);
      }

      // Remove Google Calendar event if it exists
      try {
        await deletePickupEvent(shop, pickup.id);
        console.log(`Deleted Google Calendar event for pickup ${pickup.id}`);
      } catch (error) {
        console.error("Failed to delete Google Calendar event:", error);
        // Continue even if calendar event deletion fails
      }
    } else {
      console.log(`No pickup schedule found for cancelled order ${order.name}`);
    }

    // Log the webhook for idempotency
    await prisma.webhookEvent.create({
      data: {
        shop,
        topic: "orders/cancelled",
        shopifyId: order.id.toString(),
        payload: payload as object,
      },
    });

    return json({ success: true });
  } catch (error) {
    console.error("Error processing cancelled order:", error);
    return json({ error: "Failed to process cancellation" }, { status: 500 });
  }
};
