import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getActivePlanGroups } from "../services/subscription-plans.server";

/**
 * API endpoint to get subscription plan configuration for the frontend widget.
 * Reads from SSMA SubscriptionPlanGroup model.
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

    // No SSMA v2 plan groups found
    return json({
      enabled: false,
      error: "No subscription plan configuration found",
      plans: [],
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

