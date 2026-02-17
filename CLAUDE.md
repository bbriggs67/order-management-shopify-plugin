# Susie's Sourdough Manager - Claude Code Context

> **IMPORTANT FOR CLAUDE**: When making changes, update this file AND add an entry to `CHANGE_HISTORY.md`.

## Quick Start

```bash
npm install
npm run dev                      # Local dev (requires Shopify CLI)
npm run build                    # Build for production
npx shopify app deploy --config shopify.app.susies-sourdough-manager.toml
```

## Project Overview

Shopify app for managing sourdough bread subscriptions with local pickup scheduling. Built for a small bakery (Susie's Sourdough).

- Weekly/bi-weekly/tri-weekly subscription plans with discounts
- Customer self-service subscription portal
- Pickup date/time scheduling on cart page
- Order management dashboard

## Architecture

- **Framework**: Remix (Shopify App Template) + React + TypeScript
- **Database**: PostgreSQL via Prisma ORM
- **Hosting**: Railway (auto-deploys from `funny-leakey` branch)
- **Shopify**: App Bridge, Polaris UI, Theme Extensions

### Key Directories
```
app/routes/app.*.tsx     → Admin UI pages (embedded in Shopify admin)
app/routes/apps.*.tsx    → App proxy routes (customer-facing)
app/routes/api.*.tsx     → Internal API endpoints
app/routes/webhooks.*.tsx→ Webhook handlers
app/services/            → Business logic
extensions/              → Theme extensions (pickup scheduler, subscribe widgets)
prisma/schema.prisma     → Database schema
```

### Key Services
| Service | Purpose |
|---------|---------|
| `subscription.server.ts` | Core subscription CRUD + pickup generation |
| `subscription-plans.server.ts` | SSMA plan groups, frequencies & product CRUD |
| `subscription-billing.server.ts` | Billing lead time calculation + attempts |
| `shopify-discounts.server.ts` | Auto-create/sync discount codes in Shopify |
| `selling-plans.server.ts` | Shopify Selling Plan Groups integration |
| `pickup-availability.server.ts` | Available dates/times calculation |
| `google-calendar.server.ts` | Calendar event sync |

## Subscription Flow (SSMA-Controlled)

**Product page** → SSMA widget shows "One-time purchase" + "Subscribe & Save" options
→ Customer selects frequency → clicks Add to Cart
→ Widget intercepts submit → `/cart/add.js` → `/cart/update.js` (sets SSMA attributes) → applies discount code → navigates to `/cart`
→ **Cart page** → only date/time picker (subscription widget skips since attributes set)
→ **Checkout** → webhook reads SSMA cart attributes → creates subscription

**Two theme extension widgets:**
- `subscribe-save-product.js/liquid` — Product page (primary subscription selector)
- `subscribe-save.js/liquid` — Cart page (fallback + date/time picker support)

Cart widget auto-skips when SSMA attributes already set from product page.

**Webhook fallback**: Shopify intermittently omits `note_attributes` from `orders/create` webhook (known bug). Webhook re-fetches order via GraphQL when attributes are missing.

## Important Notes

1. **Timezone**: All dates use Pacific Time. Use `T12:00:00` (noon) when constructing dates to avoid UTC midnight → Pacific previous-day bug.
2. **Theme Extension schema**: Block `name` max 25 characters.
3. **Shopify discounts**: `discountCodeBasicCreate` requires POSITIVE decimal (0.1 for 10%).
4. **Frequency ordering**: `getActivePlanGroups()` sorts by `[sortOrder, intervalCount]`. All frequencies default to `sortOrder: 0`, so `intervalCount` is the effective sort.
5. **Subscriptions page**: Only queries Shopify SubscriptionContract API for actual contract GIDs. SSMA-native subscriptions display frequency/discount from local DB.
6. **App Proxy**: Configured at `/apps/my-subscription`. Shopify strips subpath when forwarding.
7. **Test Store**: `aheajv-fg.myshopify.com`. **Live Store**: `susiessourdough.com`
8. **Webhook attributes**: Shopify REST webhooks use `name` (not `key`) for note_attributes.

## SSMA Subscription Plan Groups (v2)

- `SubscriptionPlanGroup` → name, billingLeadHours, isActive
- `SubscriptionPlanFrequency` → interval, discount, discount code, shopifyDiscountId
- `SubscriptionPlanProduct` → shopifyProductId, title, imageUrl
- API: `/apps/my-subscription/selling-plans?shop=...` returns groups + flat plans
- Auto-sync: Adding/updating frequencies auto-creates discount codes and selling plans
- Settings UI at `app.settings.subscriptions.tsx` (plan groups, sync buttons, billing management)

## Debug Tools

- `/app/debug/test-subscription` — Create test subscriptions without live orders
- `/app/debug/subscriptions` — View raw subscription data
- Settings page → Advanced/Debug section

## Database Migrations

```bash
npx prisma migrate dev --name migration_name   # Local
npx prisma migrate deploy                       # Production (Railway runs this)
```

## Deploying

1. Commit and push to `funny-leakey` → Railway auto-deploys backend
2. Theme extension changes also need: `npx shopify app deploy --force --config shopify.app.susies-sourdough-manager.toml`

## Polaris Gotchas

- `Badge` does NOT have `tone="subdued"` — use no tone for neutral
- `InlineStack` uses `blockAlign` not `blockAlignment`

## Related Docs

- `CHANGE_HISTORY.md` - Detailed change log with file lists
- `PRODUCTION_TRANSITION_PLAN.md` - Production rollout plan
