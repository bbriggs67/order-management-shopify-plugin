# Shopify Dev Docs Compliance Report

> Last reviewed: 2026-02-20

## PASSING — Shopify API Compliance

| Area | Status | Details |
|------|--------|---------|
| `/cart/add.js` selling_plan param | PASS | Uses `selling_plan` (underscore, lowercase) with numeric ID |
| Selling plan ID format | PASS | `apps.selling-plans.tsx` line 84 extracts numeric ID from GID (`plan.id.split("/").pop()`) |
| Pricing policies | PASS | Selling plans use fixed pricing policy with PERCENTAGE adjustment |
| Cart attributes via `/cart/update.js` | PASS | Sets `Subscription Enabled`, `Subscription Frequency`, `Subscription Discount` as separate AJAX call |
| Express checkout hidden | PASS | Accelerated checkout (Apple Pay, Shop Pay) hidden via CSS on product pages |
| Date/time validation | PASS | Pickup scheduler blocks checkout if date/time not selected |
| Webhook idempotency | PASS | `WebhookEvent` table prevents duplicate processing |
| Missing note_attributes fallback | PASS | GraphQL re-fetch when webhook omits `note_attributes` (known Shopify bug) |

## PREVIOUSLY NON-BLOCKING ISSUES — All Fixed 2026-02-20

### 1. `discountPercent` column was Int but triweekly is 2.5% — FIXED
- Changed `SubscriptionPickup.discountPercent` from `Int` to `Float`
- Migration: `20260220_discount_percent_float`

### 2. `calculateNextPickupDate()` didn't handle TRIWEEKLY — FIXED
- Changed to `frequency === "WEEKLY" ? 7 : frequency === "TRIWEEKLY" ? 21 : 14`
- Fixed in both `subscription.server.ts` and `subscription-billing.server.ts`

### 3. Hardcoded discount defaults in webhook handler — FIXED
- `createSubscriptionFromOrder()` and `createSubscriptionFromContract()` now call `findFrequencyByLabel()` to read from DB
- Falls back to hardcoded defaults only if DB lookup fails

### 4. `subscription_contracts.update.tsx` ignored TRIWEEKLY — FIXED
- Now maps: `interval_count` 1=WEEKLY, 3=TRIWEEKLY, default=BIWEEKLY
- Also uses DB lookup for discount percent

### 5. `restoreSelection()` referenced stale discountCode property — FIXED
- Changed `discountCode: radio.dataset.discountCode` to `sellingPlanId: radio.dataset.sellingPlanId`

### 6. Potential duplicate subscriptions from dual webhook handlers — FIXED
- Added 5-minute duplicate check in `subscription_contracts/create` webhook
- If `orders/create` already created a subscription for the same customer, skips creation

## PRE-LAUNCH TODO — Required Before Going Fully Live

### 7. Customer Account Subscription Management Extension — TODO
- **Problem**: The customer-facing "Subscription management" page on Shopify account shows "No subscriptions purchased" for SSMA orders. This page is powered by the legacy Shopify Subscriptions app, which only displays contracts it owns. SSMA-owned subscription contracts are invisible there.
- **Solution**: Build a Customer Account UI Extension (`customer-account.page.render`) for SSMA that:
  - Queries SSMA subscription data via app proxy
  - Displays active/paused subscriptions with frequency, next pickup date, items
  - Provides skip/pause/cancel/reschedule actions
- **Reference**: [Shopify Customer Account UI Extensions](https://shopify.dev/docs/api/customer-account-ui-extensions), [Subscription Extensions](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/subscriptions-app/extensions)
- **Priority**: Must be done before decommissioning the legacy Shopify Subscriptions app and going live on the production theme
