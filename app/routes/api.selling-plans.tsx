import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { getActivePlanGroups } from "../services/subscription-plans.server";

/**
 * API endpoint to get subscription plan configuration for the frontend widget.
 * Primary: reads from SSMA SubscriptionPlanGroup model.
 * Fallback: reads from legacy SellingPlanConfig for shops that haven't migrated.
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
      }, { headers });
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
      }, { headers });
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
        billingLeadHours: 85,
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
        billingLeadHours: 85,
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
        billingLeadHours: 85,
      });
    }

    return json({
      enabled: true,
      source: "legacy",
      groupId: config.sellingPlanGroupId,
      plans,
    }, { headers });
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    return json({
      enabled: false,
      error: "Failed to fetch subscription plans",
      plans: [],
    }, { status: 500, headers });
  }
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
