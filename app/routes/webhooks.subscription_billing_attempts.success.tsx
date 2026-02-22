import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  calculateBillingDate,
  calculateNextPickupDate,
  extractTimeSlotStart,
} from "../services/subscription-billing.server";
import { formatDateISOPacific } from "../utils/timezone.server";

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
          payload: {},
        },
      });

      return json({ message: "No subscription found" });
    }

    console.log(`Billing successful for subscription ${subscription.id}, order: ${billingAttempt.order_id}`);

    // Update billing attempt log if it exists
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
          status: "SUCCESS",
          orderId: billingAttempt.order_id,
        },
      });
    } else {
      // Create a log entry if we don't have one (billing initiated by Shopify directly)
      await prisma.billingAttemptLog.create({
        data: {
          shop,
          subscriptionPickupId: subscription.id,
          shopifyBillingId: billingAttempt.admin_graphql_api_id,
          idempotencyKey: `webhook-success-${billingAttempt.admin_graphql_api_id}`,
          status: "SUCCESS",
          orderId: billingAttempt.order_id,
          billingCycle: subscription.billingCycleCount + 1,
        },
      });
    }

    // Calculate next pickup and billing dates
    const nextPickupDate = calculateNextPickupDate(
      subscription.nextPickupDate || new Date(),
      subscription.preferredDay,
      subscription.frequency
    );

    const timeSlotStart =
      subscription.preferredTimeSlotStart ||
      extractTimeSlotStart(subscription.preferredTimeSlot);

    // Use subscription's custom billing lead hours
    const nextBillingDate = calculateBillingDate(
      nextPickupDate,
      timeSlotStart,
      subscription.billingLeadHours
    );

    // Update subscription with success status and next dates
    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: {
        lastBillingStatus: "SUCCESS",
        lastBillingAttemptId: billingAttempt.admin_graphql_api_id,
        lastBillingAttemptAt: new Date(),
        billingFailureCount: 0, // Reset on success
        billingFailureReason: null,
        billingCycleCount: subscription.billingCycleCount + 1,
        nextPickupDate,
        nextBillingDate,
        // Store time slot start if not already stored
        preferredTimeSlotStart: timeSlotStart,
      },
    });

    console.log(
      `Updated subscription ${subscription.id}: next pickup ${formatDateISOPacific(nextPickupDate)}, next billing ${formatDateISOPacific(nextBillingDate)}`
    );

    // Note: The order/create webhook will handle creating the PickupSchedule
    // when the order is created from this billing attempt

    // Log the webhook for idempotency
    await prisma.webhookEvent.create({
      data: {
        shop,
        topic: "subscription_billing_attempts/success",
        shopifyId: billingAttempt.admin_graphql_api_id,
        payload: {},
      },
    });

    return json({
      success: true,
      subscriptionId: subscription.id,
      nextPickupDate: formatDateISOPacific(nextPickupDate),
      nextBillingDate: formatDateISOPacific(nextBillingDate),
    });
  } catch (error) {
    console.error("Error processing billing success:", error);
    return json({ error: "Failed to process billing success" }, { status: 500 });
  }
};
