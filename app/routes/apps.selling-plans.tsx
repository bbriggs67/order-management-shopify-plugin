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

/** Selling plan ID mapping cache (per shop, refreshed every 5 min) */
const sellingPlanCache: Record<string, { data: Record<string, string>; expires: number }> = {};

/**
 * Fetch Shopify selling plan IDs and build a mapping from
 * `${interval}:${intervalCount}` to the Shopify selling plan numeric ID.
 * This is needed so the storefront widget can add items to cart
 * with the correct selling_plan parameter for native pricing discounts.
 */
async function getSellingPlanIdMap(shop: string): Promise<Record<string, string>> {
  const now = Date.now();
  if (sellingPlanCache[shop] && sellingPlanCache[shop].expires > now) {
    return sellingPlanCache[shop].data;
  }

  try {
    const session = await prisma.session.findFirst({ where: { shop } });
    if (!session?.accessToken) return {};

    const resp = await fetch(`https://${shop}/admin/api/2025-04/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({
        query: `{
          sellingPlanGroups(first: 10) {
            nodes {
              sellingPlans(first: 20) {
                nodes {
                  id
                  deliveryPolicy {
                    ... on SellingPlanRecurringDeliveryPolicy {
                      interval
                      intervalCount
                    }
                  }
                }
              }
            }
          }
        }`,
      }),
    });

    const data = (await resp.json()) as {
      data?: {
        sellingPlanGroups: {
          nodes: Array<{
            sellingPlans: {
              nodes: Array<{
                id: string;
                deliveryPolicy: { interval: string; intervalCount: number };
              }>;
            };
          }>;
        };
      };
    };

    const map: Record<string, string> = {};
    for (const group of data.data?.sellingPlanGroups?.nodes || []) {
      for (const plan of group.sellingPlans?.nodes || []) {
        const policy = plan.deliveryPolicy;
        if (policy?.interval && policy?.intervalCount) {
          // Extract numeric ID from GID (e.g., "gid://shopify/SellingPlan/4240146644" -> "4240146644")
          const numericId = plan.id.split("/").pop() || "";
          map[`${policy.interval}:${policy.intervalCount}`] = numericId;
        }
      }
    }

    sellingPlanCache[shop] = { data: map, expires: now + 5 * 60 * 1000 };
    console.log("Selling plan ID map:", JSON.stringify(map));
    return map;
  } catch (e) {
    console.warn("Failed to fetch selling plan IDs:", e);
    return {};
  }
}

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

    // Fetch Shopify selling plan ID mapping so the widget can add items
    // to cart with the correct selling_plan parameter for native pricing
    const sellingPlanIds = await getSellingPlanIdMap(shop);

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
          // Shopify selling plan numeric ID for /cart/add.js
          sellingPlanId: sellingPlanIds[`${freq.interval}:${freq.intervalCount}`] || null,
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
            sellingPlanId: sellingPlanIds[`${f.interval}:${f.intervalCount}`] || null,
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
