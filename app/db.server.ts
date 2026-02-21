import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

/**
 * Create a Prisma client configured for Railway cold-start resilience.
 *
 * Key settings:
 * - `connect_timeout`: seconds to wait for a DB connection (raised for cold starts)
 * - `pool_timeout`: seconds to wait for a connection from the pool
 * - `connection_limit`: keep low for Railway (avoids hogging idle connections)
 * - `idle_in_transaction_session_timeout`: kill idle-in-transaction connections
 *
 * These are passed as query params on DATABASE_URL so they work with any
 * PostgreSQL provider (Railway, Neon, Supabase, etc.).
 */
function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL || "";

  // Append connection pool params if not already present
  const url = new URL(databaseUrl);
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", "5");
  }
  if (!url.searchParams.has("connect_timeout")) {
    url.searchParams.set("connect_timeout", "30");
  }
  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set("pool_timeout", "30");
  }

  return new PrismaClient({
    datasourceUrl: url.toString(),
    log: process.env.NODE_ENV === "production"
      ? ["error", "warn"]
      : ["query", "error", "warn"],
  });
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

/**
 * Warm the database connection pool.
 * Call this on server startup so the first real request doesn't pay
 * the cold-start connection penalty.
 *
 * Returns true if the connection is healthy, false otherwise.
 */
export async function warmDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database warmup failed:", error);
    return false;
  }
}

export default prisma;
