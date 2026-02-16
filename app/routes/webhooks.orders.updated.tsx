import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Attribute keys that match the checkout extension
const ATTR_PICKUP_DATE = "Pickup Date";
const ATTR_PICKUP_TIME = "Pickup Time Slot";

interface OrderAttribute {
  name: string;  // Shopify REST API uses "name", not "key"
  value: string;
}

interface OrderWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string;
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
  financial_status: string; // "paid", "refunded", "partially_refunded", "pending", etc.
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

      // Also cancel linked subscription if exists
      if (pickup.subscriptionPickupId) {
        await prisma.subscriptionPickup.update({
          where: { id: pickup.subscriptionPickupId },
          data: {
            status: "CANCELLED",
            pauseReason: "Order cancelled",
          },
        });
        console.log(`Cancelled subscription ${pickup.subscriptionPickupId} due to order cancellation`);
      }

      console.log(`Marked pickup ${pickup.id} as cancelled due to order cancellation`);
      return json({ success: true, action: "cancelled" });
    }

    // If order was fully refunded, cancel the pickup and subscription
    if (order.financial_status === "refunded") {
      await prisma.pickupSchedule.update({
        where: { id: pickup.id },
        data: { pickupStatus: "CANCELLED" },
      });

      // Also cancel linked subscription if exists
      if (pickup.subscriptionPickupId) {
        await prisma.subscriptionPickup.update({
          where: { id: pickup.subscriptionPickupId },
          data: {
            status: "CANCELLED",
            pauseReason: "Order fully refunded",
          },
        });
        console.log(`Cancelled subscription ${pickup.subscriptionPickupId} due to full refund`);
      }

      console.log(`Marked pickup ${pickup.id} as cancelled due to full refund`);
      return json({ success: true, action: "refunded" });
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

    // Check for pickup date/time updates from order attributes
    const attributes = order.note_attributes || [];
    const getAttr = (key: string) =>
      attributes.find((a) => a.name === key)?.value || null;  // Use "name" not "key"

    const pickupDateRaw = getAttr(ATTR_PICKUP_DATE);
    const pickupTimeSlot = getAttr(ATTR_PICKUP_TIME);

    // Parse pickup date if provided
    // Supports formats: "Friday, January 17 (2025-01-17)", "Wednesday, February 25", "2025-01-17"
    let newPickupDate: Date | null = null;
    if (pickupDateRaw) {
      const isoDateMatch = pickupDateRaw.match(/\((\d{4}-\d{2}-\d{2})\)/);
      const plainIsoMatch = pickupDateRaw.match(/^(\d{4}-\d{2}-\d{2})$/);

      if (isoDateMatch) {
        newPickupDate = new Date(isoDateMatch[1] + "T12:00:00");
      } else if (plainIsoMatch) {
        newPickupDate = new Date(plainIsoMatch[1] + "T12:00:00");
      } else {
        // Format: "Wednesday, February 25" - need to infer year
        const currentYear = new Date().getFullYear();
        const dateWithYear = `${pickupDateRaw}, ${currentYear}`;
        let parsedDate = new Date(dateWithYear);

        if (isNaN(parsedDate.getTime())) {
          // Try removing day name
          const withoutDayName = pickupDateRaw.replace(/^[A-Za-z]+,\s*/, "");
          parsedDate = new Date(`${withoutDayName}, ${currentYear}`);
        }

        if (!isNaN(parsedDate.getTime())) {
          // If date is more than 7 days in past, assume next year
          const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (parsedDate < weekAgo) {
            parsedDate.setFullYear(currentYear + 1);
          }
          newPickupDate = parsedDate;
        }
      }
    }

    // Build update data
    const updateData: {
      customerName?: string;
      customerEmail?: string | null;
      customerPhone?: string | null;
      pickupDate?: Date;
      pickupTimeSlot?: string;
    } = {};

    // Check what has changed
    if (customerName !== pickup.customerName) updateData.customerName = customerName;
    if (customerEmail !== pickup.customerEmail) updateData.customerEmail = customerEmail;
    if (customerPhone !== pickup.customerPhone) updateData.customerPhone = customerPhone;

    // Update pickup date/time if changed
    if (newPickupDate && newPickupDate.getTime() !== pickup.pickupDate.getTime()) {
      updateData.pickupDate = newPickupDate;
      console.log(`Updating pickup date from ${pickup.pickupDate} to ${newPickupDate}`);
    }
    if (pickupTimeSlot && pickupTimeSlot !== pickup.pickupTimeSlot) {
      updateData.pickupTimeSlot = pickupTimeSlot;
      console.log(`Updating pickup time from ${pickup.pickupTimeSlot} to ${pickupTimeSlot}`);
    }

    const hasChanges = Object.keys(updateData).length > 0;

    if (hasChanges) {
      await prisma.pickupSchedule.update({
        where: { id: pickup.id },
        data: updateData,
      });
      console.log(`Updated pickup ${pickup.id}:`, Object.keys(updateData).join(", "));
    }

    return json({ success: true, updated: hasChanges });
  } catch (error) {
    console.error("Error processing order update:", error);
    return json({ error: "Failed to process update" }, { status: 500 });
  }
};
