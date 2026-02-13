import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

/**
 * API endpoint to get selling plan IDs for the frontend widget
 * This allows the subscribe-save widget to use actual selling plan IDs
 * instead of just properties, enabling proper Shopify subscription creation
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  // Set CORS headers for cross-origin requests from the storefront
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300", // Cache for 5 minutes
  };

  if (!shop) {
    return json({ error: "Shop parameter required" }, { status: 400, headers });
  }

  try {
    // Get selling plan config from database
    const config = await prisma.sellingPlanConfig.findUnique({
      where: { shop },
      include: {
        additionalPlans: true,
      },
    });

    if (!config) {
      return json({
        enabled: false,
        error: "No selling plan configuration found",
        plans: [],
      }, { headers });
    }

    // Build the plans array with all configured selling plans
    const plans: Array<{
      id: string;
      frequency: string;
      intervalCount: number;
      discount: number;
      discountType: string;
      name: string;
    }> = [];

    // Add weekly plan if configured
    if (config.weeklySellingPlanId) {
      plans.push({
        id: config.weeklySellingPlanId,
        frequency: "WEEKLY",
        intervalCount: 1,
        discount: config.weeklyDiscount,
        discountType: "PERCENTAGE",
        name: `Deliver every week (${config.weeklyDiscount}% off)`,
      });
    }

    // Add biweekly plan if configured
    if (config.biweeklySellingPlanId) {
      plans.push({
        id: config.biweeklySellingPlanId,
        frequency: "BIWEEKLY",
        intervalCount: 2,
        discount: config.biweeklyDiscount,
        discountType: "PERCENTAGE",
        name: `Deliver every 2 weeks (${config.biweeklyDiscount}% off)`,
      });
    }

    // Add any additional plans (like triweekly)
    for (const plan of config.additionalPlans) {
      let frequency = "CUSTOM";
      if (plan.interval === "WEEK" && plan.intervalCount === 3) {
        frequency = "TRIWEEKLY";
      } else if (plan.interval === "WEEK" && plan.intervalCount === 1) {
        frequency = "WEEKLY";
      } else if (plan.interval === "WEEK" && plan.intervalCount === 2) {
        frequency = "BIWEEKLY";
      }

      plans.push({
        id: plan.shopifyPlanId,
        frequency,
        intervalCount: plan.intervalCount,
        discount: plan.discount,
        discountType: plan.discountType,
        name: plan.name,
      });
    }

    return json({
      enabled: true,
      groupId: config.sellingPlanGroupId,
      plans,
    }, { headers });
  } catch (error) {
    console.error("Error fetching selling plans:", error);
    return json({
      enabled: false,
      error: "Failed to fetch selling plans",
      plans: [],
    }, { status: 500, headers });
  }
};
