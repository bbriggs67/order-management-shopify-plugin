import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

/**
 * Debug endpoint to verify webhook delivery is working
 * This accepts ALL incoming requests and logs them
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("=== WEBHOOK DEBUG - GET REQUEST ===");
  console.log("URL:", request.url);
  console.log("Headers:", Object.fromEntries(request.headers.entries()));
  return json({
    status: "ok",
    message: "Webhook debug endpoint is active",
    timestamp: new Date().toISOString()
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("=== WEBHOOK DEBUG - POST REQUEST ===");
  console.log("URL:", request.url);
  console.log("Method:", request.method);

  // Log all headers
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  console.log("Headers:", JSON.stringify(headers, null, 2));

  // Log Shopify-specific headers
  console.log("Shopify Topic:", request.headers.get("x-shopify-topic"));
  console.log("Shopify HMAC:", request.headers.get("x-shopify-hmac-sha256"));
  console.log("Shopify Shop:", request.headers.get("x-shopify-shop-domain"));
  console.log("Shopify API Version:", request.headers.get("x-shopify-api-version"));
  console.log("Shopify Webhook ID:", request.headers.get("x-shopify-webhook-id"));

  // Try to read body
  try {
    const text = await request.text();
    console.log("Body length:", text.length);
    if (text.length > 0 && text.length < 5000) {
      const payload = JSON.parse(text);
      console.log("Parsed payload - Order ID:", payload.id);
      console.log("Parsed payload - Order Name:", payload.name);
    }
  } catch (e) {
    console.log("Could not parse body:", e);
  }

  console.log("=== END WEBHOOK DEBUG ===");

  return json({
    received: true,
    timestamp: new Date().toISOString()
  });
};
