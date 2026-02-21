import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface BillingAttemptFailurePayload {
  admin_graphql_api_id: string;
  subscription_contract_id: string;
  ready: boolean;
  error_code: string;
  error_message?: string;
}

const MAX_BILLING_FAILURES = 3;

/**
 * Webhook handler for failed subscription billing attempts
 * This is triggered when a billing attempt fails (payment declined, etc.)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} for shop: ${shop}`);

  if (!payload || typeof payload !== "object") {
    console.error("Invalid webhook payload");
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const billingAttempt = payload as unknown as BillingAttemptFailurePayload;

  // Check for idempotency
  const existingEvent = await prisma.webhookEvent.findUnique({
    where: {
      shop_topic_shopifyId: {
        shop,
        topic: "subscription_billing_attempts/failure",
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
          topic: "subscription_billing_attempts/failure",
          shopifyId: billingAttempt.admin_graphql_api_id,
          payload: payload as object,
        },
      });

      return json({ message: "No subscription found" });
    }

    console.log(
      `Billing failed for subscription ${subscription.id}, error: ${billingAttempt.error_code}`
    );

    // Find and update the billing attempt log if it exists
    const billingLog = await prisma.billingAttemptLog.findFirst({
      where: {
        subscriptionPickupId: subscription.id,
        shopifyBillingId: billingAttempt.admin_graphql_api_id,
      },
    });

    if (billingLog) {
      await prisma.billingAttemptLog.update({
        where: { id: billingLog.id },
        data: {
          status: "FAILED",
          errorCode: billingAttempt.error_code,
          errorMessage: billingAttempt.error_message || null,
        },
      });
    } else {
      // Create a new log entry if we don't have one (billing initiated by Shopify)
      await prisma.billingAttemptLog.create({
        data: {
          shop,
          subscriptionPickupId: subscription.id,
          shopifyBillingId: billingAttempt.admin_graphql_api_id,
          idempotencyKey: `webhook-${billingAttempt.admin_graphql_api_id}`,
          status: "FAILED",
          errorCode: billingAttempt.error_code,
          errorMessage: billingAttempt.error_message || null,
          billingCycle: subscription.billingCycleCount + 1,
        },
      });
    }

    // Increment failure count
    const newFailureCount = subscription.billingFailureCount + 1;

    const updateData: {
      lastBillingStatus: string;
      lastBillingAttemptId: string;
      lastBillingAttemptAt: Date;
      billingFailureCount: number;
      billingFailureReason: string;
      status?: "PAUSED";
      pauseReason?: string;
    } = {
      lastBillingStatus: "FAILED",
      lastBillingAttemptId: billingAttempt.admin_graphql_api_id,
      lastBillingAttemptAt: new Date(),
      billingFailureCount: newFailureCount,
      billingFailureReason: billingAttempt.error_message || billingAttempt.error_code,
    };

    // Pause subscription after max failures
    if (newFailureCount >= MAX_BILLING_FAILURES) {
      updateData.status = "PAUSED";
      updateData.pauseReason = `Billing failed ${MAX_BILLING_FAILURES} times: ${billingAttempt.error_code}`;
      console.log(
        `Pausing subscription ${subscription.id} after ${MAX_BILLING_FAILURES} billing failures`
      );
    }

    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: updateData,
    });

    // Log the webhook for idempotency
    await prisma.webhookEvent.create({
      data: {
        shop,
        topic: "subscription_billing_attempts/failure",
        shopifyId: billingAttempt.admin_graphql_api_id,
        payload: payload as object,
      },
    });

    return json({
      success: true,
      subscriptionId: subscription.id,
      failureCount: newFailureCount,
      paused: newFailureCount >= MAX_BILLING_FAILURES,
    });
  } catch (error) {
    console.error("Error processing billing failure:", error);
    return json({ error: "Failed to process billing failure" }, { status: 500 });
  }
};
