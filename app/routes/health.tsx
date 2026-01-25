import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

// Health check endpoint for Railway monitoring
export const loader: LoaderFunction = async () => {
  const checks: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  };

  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "connected";
  } catch (error) {
    checks.database = "error";
    checks.databaseError = error instanceof Error ? error.message : "Unknown error";
    checks.status = "degraded";
  }

  // Check required env vars (without exposing values)
  checks.config = {
    shopifyApiKey: !!process.env.SHOPIFY_API_KEY,
    shopifyApiSecret: !!process.env.SHOPIFY_API_SECRET,
    shopifyAppUrl: !!process.env.SHOPIFY_APP_URL,
    databaseUrl: !!process.env.DATABASE_URL,
  };

  return json(checks, {
    status: checks.status === "ok" ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
    },
  });
};
