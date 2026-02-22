import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import {
  processSubscriptions,
  resumePausedSubscriptions,
} from "../services/subscription.server";
import { processDueBillings } from "../services/subscription-billing.server";
import { unauthenticated } from "../shopify.server";

/**
 * API endpoint for processing subscriptions
 * Should be called frequently (hourly recommended) via a cron job
 *
 * This endpoint:
 * 1. Processes billing for subscriptions due (84 hours before pickup)
 * 2. Resumes paused subscriptions that have reached their pausedUntil date
 * 3. Creates pickup schedules for active subscriptions due for pickup
 *
 * Security: Use a secret token to protect this endpoint
 * Example cron call:
 *   curl -X POST https://your-app.com/api/cron/process-subscriptions \
 *     -H "Authorization: Bearer YOUR_CRON_SECRET"
 */

const CRON_SECRET = process.env.CRON_SECRET || "";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verify the request is authorized
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!CRON_SECRET || token !== CRON_SECRET) {
    console.error("Unauthorized cron request");
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("Starting subscription processing cron job");

  try {
    // Get all unique shops with active subscriptions
    const shops = await prisma.subscriptionPickup.findMany({
      where: {
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      select: { shop: true },
      distinct: ["shop"],
    });

    const results: Record<
      string,
      {
        billing: {
          processed: number;
          successful: number;
          failed: number;
          errors: string[];
        };
        resumed: number;
        processed: number;
        created: number;
        errors: string[];
      }
    > = {};

    for (const { shop } of shops) {
      // Initialize result for this shop
      let billingResult = {
        processed: 0,
        successful: 0,
        failed: 0,
        errors: [] as string[],
      };

      // Step 1: Process billing for subscriptions due (84 hours before pickup)
      try {
        // Get admin API access for this shop
        const { admin } = await unauthenticated.admin(shop);

        billingResult = await processDueBillings(shop, admin);

        console.log(
          `Shop ${shop} billing: processed=${billingResult.processed}, successful=${billingResult.successful}, failed=${billingResult.failed}`
        );
      } catch (error) {
        console.error(`Failed to process billing for shop ${shop}:`, error);
        billingResult.errors.push(`Billing processing error: ${error}`);
      }

      // Step 2: Resume any paused subscriptions that should be resumed
      const resumed = await resumePausedSubscriptions(shop);

      // Step 3: Process active subscriptions and create pickup schedules
      const { processed, created, errors } = await processSubscriptions(shop);

      results[shop] = {
        billing: billingResult,
        resumed,
        processed,
        created,
        errors,
      };

      console.log(
        `Shop ${shop}: billing=${billingResult.successful}/${billingResult.processed}, resumed=${resumed}, processed=${processed}, created=${created}, errors=${errors.length}`
      );
    }

    // Step 4: Clean up old WebhookEvent records (older than 30 days)
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const deleted = await prisma.webhookEvent.deleteMany({
        where: {
          processedAt: { lt: thirtyDaysAgo },
        },
      });
      if (deleted.count > 0) {
        console.log(`Cleaned up ${deleted.count} WebhookEvent records older than 30 days`);
      }
    } catch (cleanupError) {
      console.error("Error cleaning up old WebhookEvent records:", cleanupError);
    }

    return json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error("Error in subscription cron job:", error);
    return json(
      { error: "Failed to process subscriptions", details: String(error) },
      { status: 500 }
    );
  }
};

// GET requests return info about the endpoint
export const loader = async () => {
  return json({
    endpoint: "/api/cron/process-subscriptions",
    method: "POST",
    description:
      "Process subscriptions: 1) Bill customers 84h before pickup, 2) Resume paused subscriptions, 3) Create pickup schedules",
    auth: "Bearer token required (CRON_SECRET env var)",
    recommended: "Run hourly for accurate billing timing",
  });
};
