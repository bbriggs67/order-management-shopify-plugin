/**
 * Selling Plans API for storefront (via App Proxy)
 *
 * This endpoint is accessible via Shopify's app proxy at:
 * https://yourstore.com/apps/my-subscription/selling-plans
 *
 * Shopify's app proxy forwards the request to:
 * https://yourapp.com/apps/selling-plans
 * (The "my-subscription" subpath is stripped by the proxy)
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { getActivePlanGroups } from "../services/subscription-plans.server";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300", // Cache for 5 minutes
};

/** Map interval + count to legacy frequency label */
function mapToFrequencyLabel(interval: string, intervalCount: number): string {
  if (interval === "WEEK") {
    switch (intervalCount) {
      case 1: return "WEEKLY";
      case 2: return "BIWEEKLY";
      case 3: return "TRIWEEKLY";
    }
  }
  return `EVERY_${intervalCount}_${interval}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shop can come from query param or from Shopify's app proxy headers
  let shop = url.searchParams.get("shop");

  // Clean up shop domain if needed
  if (shop && !shop.includes(".myshopify.com")) {
    shop = `${shop}.myshopify.com`;
  }

  console.log("Selling plans request for shop:", shop);

  if (!shop) {
    return json({
      error: "Shop parameter required",
      enabled: false,
      plans: [],
    }, { status: 400, headers: corsHeaders });
  }

  try {
    // PRIMARY: Read from SSMA SubscriptionPlanGroup model
    const planGroups = await getActivePlanGroups(shop);

    if (planGroups.length > 0) {
      // Flat list for backward compat with current cart widget
      const plans = planGroups.flatMap((group) =>
        group.frequencies.map((freq) => ({
          id: freq.id,
          groupId: group.id,
          groupName: group.name,
          name: freq.name,
          frequency: mapToFrequencyLabel(freq.interval, freq.intervalCount),
          interval: freq.interval,
          intervalCount: freq.intervalCount,
          discountPercent: freq.discountPercent,
          discountCode: freq.discountCode,
          billingLeadHours: group.billingLeadHours,
        }))
      );

      return json({
        enabled: true,
        source: "ssma_v2",
        // Structured format (for future widget updates)
        groups: planGroups.map((g) => ({
          id: g.id,
          name: g.name,
          billingLeadHours: g.billingLeadHours,
          frequencies: g.frequencies.map((f) => ({
            id: f.id,
            name: f.name,
            frequency: mapToFrequencyLabel(f.interval, f.intervalCount),
            interval: f.interval,
            intervalCount: f.intervalCount,
            discountPercent: f.discountPercent,
            discountCode: f.discountCode,
          })),
          productIds: g.products.map((p) => p.shopifyProductId),
        })),
        // Flat list for backward compat
        plans,
      }, { headers: corsHeaders });
    }

    // FALLBACK: Read from legacy SellingPlanConfig
    const config = await prisma.sellingPlanConfig.findUnique({
      where: { shop },
      include: {
        additionalPlans: true,
      },
    });

    if (!config) {
      return json({
        enabled: false,
        error: "No subscription plan configuration found",
        plans: [],
      }, { headers: corsHeaders });
    }

    // Build plans from legacy config
    const plans: Array<{
      id: string;
      name: string;
      frequency: string;
      interval: string;
      intervalCount: number;
      discountPercent: number;
      discountCode: string | null;
      billingLeadHours: number;
    }> = [];

    if (config.weeklySellingPlanId) {
      plans.push({
        id: config.weeklySellingPlanId,
        name: `Deliver every week (${config.weeklyDiscount}% off)`,
        frequency: "WEEKLY",
        interval: "WEEK",
        intervalCount: 1,
        discountPercent: config.weeklyDiscount,
        discountCode: "SUBSCRIBE-WEEKLY-10",
        billingLeadHours: 48,
      });
    }

    if (config.biweeklySellingPlanId) {
      plans.push({
        id: config.biweeklySellingPlanId,
        name: `Deliver every 2 weeks (${config.biweeklyDiscount}% off)`,
        frequency: "BIWEEKLY",
        interval: "WEEK",
        intervalCount: 2,
        discountPercent: config.biweeklyDiscount,
        discountCode: "SUBSCRIBE-BIWEEKLY-5",
        billingLeadHours: 48,
      });
    }

    for (const plan of config.additionalPlans) {
      plans.push({
        id: plan.shopifyPlanId,
        name: plan.name,
        frequency: mapToFrequencyLabel(plan.interval, plan.intervalCount),
        interval: plan.interval,
        intervalCount: plan.intervalCount,
        discountPercent: plan.discount,
        discountCode: null,
        billingLeadHours: 48,
      });
    }

    return json({
      enabled: true,
      source: "legacy",
      groupId: config.sellingPlanGroupId,
      plans,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    return json({
      enabled: false,
      error: "Failed to fetch subscription plans",
      plans: [],
    }, { status: 500, headers: corsHeaders });
  }
};
