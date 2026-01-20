import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface SubscriptionContractPayload {
  admin_graphql_api_id: string;
  status: string; // "ACTIVE", "PAUSED", "CANCELLED"
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
  };
  billing_policy: {
    interval: string;
    interval_count: number;
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} for shop: ${shop}`);

  if (!payload || typeof payload !== "object") {
    console.error("Invalid webhook payload");
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const contract = payload as unknown as SubscriptionContractPayload;

  try {
    // Find the subscription record
    const subscription = await prisma.subscriptionPickup.findFirst({
      where: {
        shop,
        shopifyContractId: contract.admin_graphql_api_id,
      },
    });

    if (!subscription) {
      console.log(`No subscription found for contract ${contract.admin_graphql_api_id}`);
      return json({ message: "No subscription found" });
    }

    // Map Shopify status to our status
    const statusMap: Record<string, "ACTIVE" | "PAUSED" | "CANCELLED"> = {
      ACTIVE: "ACTIVE",
      PAUSED: "PAUSED",
      CANCELLED: "CANCELLED",
      EXPIRED: "CANCELLED",
      FAILED: "CANCELLED",
    };

    const newStatus = statusMap[contract.status] || "ACTIVE";

    // Update customer info and status
    const customerName = `${contract.customer.first_name} ${contract.customer.last_name}`.trim();
    const frequency =
      contract.billing_policy.interval_count === 1 ? "WEEKLY" : "BIWEEKLY";
    const discountPercent = frequency === "WEEKLY" ? 10 : 5;

    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: {
        status: newStatus,
        customerName,
        customerEmail: contract.customer.email || subscription.customerEmail,
        customerPhone: contract.customer.phone || subscription.customerPhone,
        frequency,
        discountPercent,
        // Clear next dates if cancelled
        ...(newStatus === "CANCELLED" && {
          nextPickupDate: null,
          nextBillingDate: null,
        }),
      },
    });

    console.log(
      `Updated subscription ${subscription.id} from contract update, status: ${newStatus}`
    );

    return json({ success: true, status: newStatus });
  } catch (error) {
    console.error("Error updating subscription from contract:", error);
    return json({ error: "Failed to update subscription" }, { status: 500 });
  }
};
