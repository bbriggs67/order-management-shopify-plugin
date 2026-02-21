import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscriptionFromContract } from "../services/subscription.server";
import { createPickupEvent } from "../services/google-calendar.server";

interface SubscriptionContractPayload {
  admin_graphql_api_id: string;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
  };
  billing_policy: {
    interval: string; // "WEEK"
    interval_count: number; // 1 for weekly, 2 for bi-weekly
  };
  delivery_policy: {
    interval: string;
    interval_count: number;
  };
  lines: {
    edges: Array<{
      node: {
        product_id: string;
        variant_id: string;
        title: string;
        quantity: number;
      };
    }>;
  };
  note_attributes?: Array<{
    name: string;
    value: string;
  }>;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} for shop: ${shop}`);

  if (!payload || typeof payload !== "object") {
    console.error("Invalid webhook payload");
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const contract = payload as unknown as SubscriptionContractPayload;

  // Check for idempotency
  const existingEvent = await prisma.webhookEvent.findUnique({
    where: {
      shop_topic_shopifyId: {
        shop,
        topic: "subscription_contracts/create",
        shopifyId: contract.admin_graphql_api_id,
      },
    },
  });

  if (existingEvent) {
    console.log(`Webhook already processed for contract ${contract.admin_graphql_api_id}`);
    return json({ message: "Already processed" });
  }

  try {
    // Check if orders/create webhook already created a subscription for this customer
    // with matching frequency. The orders/create webhook stores the order GID as
    // shopifyContractId, while this webhook uses the contract GID — so the unique
    // constraint alone doesn't prevent duplicates.
    const recentDuplicateCheck = await prisma.subscriptionPickup.findFirst({
      where: {
        shop,
        customerEmail: contract.customer.email,
        status: "ACTIVE",
        createdAt: {
          // Only check subscriptions created in the last 5 minutes (both webhooks fire close together)
          gte: new Date(Date.now() - 5 * 60 * 1000),
        },
      },
    });

    if (recentDuplicateCheck) {
      console.log(`Subscription already exists for customer ${contract.customer.email} (created by orders/create webhook: ${recentDuplicateCheck.id}). Updating shopifyContractId and skipping duplicate.`);

      // Update the existing subscription with the real contract GID
      // (orders/create webhook stores the order GID as a placeholder)
      await prisma.subscriptionPickup.update({
        where: { id: recentDuplicateCheck.id },
        data: { shopifyContractId: contract.admin_graphql_api_id },
      });

      // Still log the webhook for idempotency
      await prisma.webhookEvent.create({
        data: {
          shop,
          topic: "subscription_contracts/create",
          shopifyId: contract.admin_graphql_api_id,
          payload: payload as object,
        },
      });

      return json({ message: "Updated shopifyContractId on existing subscription" });
    }

    // Extract customer info
    const customerName = `${contract.customer.first_name} ${contract.customer.last_name}`.trim();
    const customerEmail = contract.customer.email || null;
    const customerPhone = contract.customer.phone || null;

    // Determine frequency from billing policy
    let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";
    switch (contract.billing_policy.interval_count) {
      case 1:
        frequency = "WEEKLY";
        break;
      case 2:
        frequency = "BIWEEKLY";
        break;
      case 3:
        frequency = "TRIWEEKLY";
        break;
      default:
        // Default to weekly for unknown intervals
        console.warn(`Unknown interval count: ${contract.billing_policy.interval_count}, defaulting to WEEKLY`);
        frequency = "WEEKLY";
    }

    // Extract preferred day and time slot from note attributes
    // These would be set during checkout via cart attributes
    const noteAttrs = contract.note_attributes || [];
    const getAttr = (name: string) =>
      noteAttrs.find((a) => a.name === name)?.value || null;

    const preferredDayStr = getAttr("Subscription Preferred Day");
    const preferredTimeSlot =
      getAttr("Subscription Preferred Time Slot") || "12:00 PM - 2:00 PM";

    // Default to Tuesday (2) if not specified
    const preferredDay = preferredDayStr ? parseInt(preferredDayStr, 10) : 2;

    // Create the subscription record
    const subscriptionId = await createSubscriptionFromContract(
      shop,
      contract.admin_graphql_api_id,
      customerName,
      customerEmail,
      customerPhone,
      frequency,
      preferredDay,
      preferredTimeSlot
    );

    // Get the subscription to access nextPickupDate
    const subscription = await prisma.subscriptionPickup.findUnique({
      where: { id: subscriptionId },
    });

    // Create initial pickup schedule and 4 weeks of future pickups
    if (subscription && subscription.nextPickupDate) {
      const frequencyDays = frequency === "BIWEEKLY" ? 14 : frequency === "TRIWEEKLY" ? 21 : 7;

      // Generate 5 weeks of pickups (week 0 is the first pickup)
      for (let week = 0; week <= 4; week++) {
        const pickupDate = new Date(subscription.nextPickupDate);
        pickupDate.setDate(pickupDate.getDate() + (week * frequencyDays));

        try {
          const pickupSchedule = await prisma.pickupSchedule.create({
            data: {
              shop,
              shopifyOrderId: `subscription-${subscriptionId}-week${week}`,
              shopifyOrderNumber: `SUB-${subscriptionId.slice(-6).toUpperCase()}-W${week}`,
              customerName,
              customerEmail,
              customerPhone,
              pickupDate,
              pickupTimeSlot: preferredTimeSlot,
              pickupStatus: "SCHEDULED",
              subscriptionPickupId: subscriptionId,
            },
          });

          // Create Google Calendar event
          try {
            await createPickupEvent(shop, pickupSchedule.id);
          } catch (calError) {
            console.error(`Failed to create calendar event for week ${week}:`, calError);
          }

          console.log(`Created pickup ${pickupSchedule.id} for week ${week} on ${pickupDate.toISOString()}`);
        } catch (pickupError) {
          console.error(`Failed to create pickup for week ${week}:`, pickupError);
        }
      }
      console.log(`Generated 5 weeks of pickups for subscription ${subscriptionId}`);
    }

    // Log the webhook for idempotency
    await prisma.webhookEvent.create({
      data: {
        shop,
        topic: "subscription_contracts/create",
        shopifyId: contract.admin_graphql_api_id,
        payload: payload as object,
      },
    });

    return json({ success: true });
  } catch (error) {
    console.error("Error creating subscription from contract:", error);
    return json({ error: "Failed to create subscription" }, { status: 500 });
  }
};
