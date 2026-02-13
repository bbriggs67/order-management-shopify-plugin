import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscriptionFromContract } from "../services/subscription.server";

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
    await createSubscriptionFromContract(
      shop,
      contract.admin_graphql_api_id,
      customerName,
      customerEmail,
      customerPhone,
      frequency,
      preferredDay,
      preferredTimeSlot
    );

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
