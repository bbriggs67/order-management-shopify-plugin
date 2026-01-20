import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface OrderWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string;
  email: string;
  phone: string | null;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
  } | null;
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
  cancelled_at: string | null;
  closed_at: string | null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} for shop: ${shop}`);

  if (!payload || typeof payload !== "object") {
    console.error("Invalid webhook payload");
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const order = payload as unknown as OrderWebhookPayload;

  // Note: We don't use strict idempotency for updates since the same order
  // can be updated multiple times legitimately. Instead, we just process
  // the most recent state.

  try {
    // Find the pickup schedule for this order
    const pickup = await prisma.pickupSchedule.findFirst({
      where: {
        shop,
        shopifyOrderId: order.admin_graphql_api_id,
      },
    });

    if (!pickup) {
      console.log(`No pickup schedule found for updated order ${order.name}`);
      return json({ message: "No pickup schedule found" });
    }

    // If order was cancelled, update status
    if (order.cancelled_at) {
      await prisma.pickupSchedule.update({
        where: { id: pickup.id },
        data: { pickupStatus: "CANCELLED" },
      });
      console.log(`Marked pickup ${pickup.id} as cancelled due to order cancellation`);
      return json({ success: true, action: "cancelled" });
    }

    // Update customer info if changed
    const customerName = order.customer
      ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
      : order.billing_address
        ? `${order.billing_address.first_name} ${order.billing_address.last_name}`.trim()
        : pickup.customerName;

    const customerEmail = order.email || order.customer?.email || pickup.customerEmail;
    const customerPhone =
      order.customer?.phone ||
      order.billing_address?.phone ||
      order.shipping_address?.phone ||
      order.phone ||
      pickup.customerPhone;

    // Check if anything changed
    const hasChanges =
      customerName !== pickup.customerName ||
      customerEmail !== pickup.customerEmail ||
      customerPhone !== pickup.customerPhone;

    if (hasChanges) {
      await prisma.pickupSchedule.update({
        where: { id: pickup.id },
        data: {
          customerName,
          customerEmail,
          customerPhone,
        },
      });
      console.log(`Updated customer info for pickup ${pickup.id}`);
    }

    return json({ success: true, updated: hasChanges });
  } catch (error) {
    console.error("Error processing order update:", error);
    return json({ error: "Failed to process update" }, { status: 500 });
  }
};
