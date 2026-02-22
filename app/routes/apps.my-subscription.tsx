/**
 * App Proxy: /apps/my-subscription
 *
 * This route previously served an HTML subscription management portal.
 * Subscription management has been moved to the Shopify Customer Account
 * Extensions (SubscriptionPage + ProfileBlock). This route now redirects
 * customers to their account page.
 *
 * The /apps/my-subscription proxy path is still used by:
 * - apps.selling-plans.tsx (selling plan data for storefront widgets)
 * - apps.pickup-availability.tsx (pickup availability for storefront widgets)
 * Those are separate route files and are not affected by this change.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";

  // Build the customer account URL from the shop domain
  // e.g., "susiessourdough.myshopify.com" -> "susiessourdough.com/account"
  const storeDomain = shop.replace(".myshopify.com", ".com");

  // Return a simple HTML page that redirects to the customer account
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Subscription Management</title>
  <meta http-equiv="refresh" content="0;url=https://${storeDomain}/account">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 60px 20px; color: #333; }
    a { color: #2C6ECB; }
  </style>
</head>
<body>
  <p>Subscription management has moved to your <a href="https://${storeDomain}/account">account page</a>.</p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
