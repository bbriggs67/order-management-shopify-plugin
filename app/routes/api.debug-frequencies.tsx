/**
 * Temporary debug endpoint to check frequency sortOrder values in the database.
 * GET /api/debug-frequencies
 * Returns all shops, plan groups, and their frequencies with sortOrder values.
 *
 * REMOVE THIS AFTER DEBUGGING
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    // Get ALL plan groups across all shops
    const allGroups = await prisma.subscriptionPlanGroup.findMany({
      include: {
        frequencies: {
          orderBy: [{ sortOrder: "asc" }, { intervalCount: "asc" }],
        },
        products: { select: { id: true, title: true } },
      },
    });

    // Also check the legacy SellingPlanConfig
    const legacyConfigs = await prisma.sellingPlanConfig.findMany({
      include: { additionalPlans: true },
    });

    return json({
      planGroups: allGroups.map((g) => ({
        id: g.id,
        shop: g.shop,
        name: g.name,
        isActive: g.isActive,
        sortOrder: g.sortOrder,
        frequencies: g.frequencies.map((f) => ({
          id: f.id,
          name: f.name,
          interval: f.interval,
          intervalCount: f.intervalCount,
          discountPercent: f.discountPercent,
          sortOrder: f.sortOrder,
          isActive: f.isActive,
        })),
        productCount: g.products.length,
      })),
      legacyConfigs: legacyConfigs.map((c) => ({
        shop: c.shop,
        groupId: c.sellingPlanGroupId,
        groupName: c.groupName,
        weeklyPlanId: c.weeklySellingPlanId,
        biweeklyPlanId: c.biweeklySellingPlanId,
        additionalPlans: c.additionalPlans.length,
      })),
    }, { headers });
  } catch (error) {
    return json({ error: String(error) }, { status: 500, headers });
  }
};
