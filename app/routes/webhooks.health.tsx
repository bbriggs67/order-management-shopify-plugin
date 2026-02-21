import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

/**
 * Simple health check endpoint for webhooks
 * Returns 200 OK for both GET and POST to verify the route is accessible
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("=== WEBHOOK HEALTH CHECK - GET ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("URL:", request.url);
  return json({
    status: "healthy",
    endpoint: "/webhooks/health",
    timestamp: new Date().toISOString(),
    method: "GET"
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("=== WEBHOOK HEALTH CHECK - POST ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("URL:", request.url);
  console.log("Method:", request.method);

  // Log Shopify headers if present
  const shopifyTopic = request.headers.get("x-shopify-topic");
  const shopifyShop = request.headers.get("x-shopify-shop-domain");

  if (shopifyTopic || shopifyShop) {
    console.log("Shopify Topic:", shopifyTopic);
    console.log("Shopify Shop:", shopifyShop);
    console.log("Shopify HMAC:", request.headers.get("x-shopify-hmac-sha256") ? "present" : "missing");
    console.log("Shopify Webhook ID:", request.headers.get("x-shopify-webhook-id"));
  }

  return json({
    status: "healthy",
    endpoint: "/webhooks/health",
    timestamp: new Date().toISOString(),
    method: "POST",
    hasShopifyHeaders: !!(shopifyTopic || shopifyShop)
  });
};
