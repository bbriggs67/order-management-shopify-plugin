import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface BillingAttemptPayload {
  admin_graphql_api_id: string;
  subscription_contract_id: string;
  ready: boolean;
  error_code: string | null;
  order_id: string | null;
}

/**
 * Webhook handler for successful subscription billing attempts
 * This is triggered when a customer is successfully billed for their subscription
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} for shop: ${shop}`);

  if (!payload || typeof payload !== "object") {
    console.error("Invalid webhook payload");
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const billingAttempt = payload as unknown as BillingAttemptPayload;

  // Check for idempotency
  const existingEvent = await prisma.webhookEvent.findUnique({
    where: {
      shop_topic_shopifyId: {
        shop,
        topic: "subscription_billing_attempts/success",
        shopifyId: billingAttempt.admin_graphql_api_id,
      },
    },
  });

  if (existingEvent) {
    console.log(`Webhook already processed for billing attempt ${billingAttempt.admin_graphql_api_id}`);
    return json({ message: "Already processed" });
  }

  try {
    // Find the subscription
    const subscription = await prisma.subscriptionPickup.findFirst({
      where: {
        shop,
        shopifyContractId: billingAttempt.subscription_contract_id,
      },
    });

    if (!subscription) {
      console.log(`No subscription found for contract ${billingAttempt.subscription_contract_id}`);

      // Still log the webhook for idempotency
      await prisma.webhookEvent.create({
        data: {
          shop,
          topic: "subscription_billing_attempts/success",
          shopifyId: billingAttempt.admin_graphql_api_id,
          payload: payload as object,
        },
      });

      return json({ message: "No subscription found" });
    }

    console.log(`Billing successful for subscription ${subscription.id}, order: ${billingAttempt.order_id}`);

    // The order/create webhook will handle creating the pickup schedule
    // This webhook just confirms billing was successful

    // Log the webhook for idempotency
    await prisma.webhookEvent.create({
      data: {
        shop,
        topic: "subscription_billing_attempts/success",
        shopifyId: billingAttempt.admin_graphql_api_id,
        payload: payload as object,
      },
    });

    return json({ success: true, subscriptionId: subscription.id });
  } catch (error) {
    console.error("Error processing billing success:", error);
    return json({ error: "Failed to process billing success" }, { status: 500 });
  }
};
