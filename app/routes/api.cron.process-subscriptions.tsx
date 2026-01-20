import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import {
  processSubscriptions,
  resumePausedSubscriptions,
} from "../services/subscription.server";

/**
 * API endpoint for processing subscriptions
 * Should be called daily via a cron job
 *
 * This endpoint:
 * 1. Resumes paused subscriptions that have reached their pausedUntil date
 * 2. Creates pickup schedules for active subscriptions due for pickup
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
        resumed: number;
        processed: number;
        created: number;
        errors: string[];
      }
    > = {};

    for (const { shop } of shops) {
      // First, resume any paused subscriptions that should be resumed
      const resumed = await resumePausedSubscriptions(shop);

      // Then process active subscriptions
      const { processed, created, errors } = await processSubscriptions(shop);

      results[shop] = { resumed, processed, created, errors };

      console.log(
        `Shop ${shop}: resumed=${resumed}, processed=${processed}, created=${created}, errors=${errors.length}`
      );
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
      "Process subscriptions: resume paused ones and create pickup schedules",
    auth: "Bearer token required (CRON_SECRET env var)",
  });
};
