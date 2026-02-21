import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

/**
 * Health check endpoint for Railway monitoring and cold-start warmup.
 *
 * GET /health
 *
 * Returns 200 with status "ok" if the database is reachable,
 * or 503 with status "degraded" if the database is unreachable.
 *
 * This endpoint serves two purposes:
 * 1. Railway can probe it to know the service is alive
 * 2. An external uptime service (e.g. UptimeRobot) can ping it every 5 min
 *    to keep the service warm and DB connections alive during low-traffic periods
 */
export const loader: LoaderFunction = async () => {
  const start = Date.now();
  const checks: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
  };

  // Check database connectivity and measure latency
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "connected";
    checks.dbLatencyMs = Date.now() - start;
  } catch (error) {
    checks.database = "error";
    checks.dbLatencyMs = Date.now() - start;
    checks.databaseError = error instanceof Error ? error.message : "Unknown error";
    checks.status = "degraded";
  }

  return json(checks, {
    status: checks.status === "ok" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
};
