# Susie's Sourdough Manager - Claude Code Context

> **IMPORTANT FOR CLAUDE**: When making changes, update this file AND add an entry to `CHANGE_HISTORY.md`.

## Quick Start

```bash
npm install
npm run dev                      # Local dev (requires Shopify CLI)
npm run build                    # Build for production
npx shopify app deploy --config shopify.app.susies-sourdough-manager.toml
npx shopify app release --version=VERSION --config shopify.app.susies-sourdough-manager.toml --allow-updates
```

## Project Overview

Shopify app for managing sourdough bread subscriptions with local pickup scheduling. Built for a small bakery (Susie's Sourdough) with 17 existing subscribers.

- Weekly/bi-weekly/tri-weekly subscription plans with discounts
- Customer self-service subscription portal
- Pickup date/time scheduling on cart page
- Configurable pickup days, time slots, blackout dates
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
app/utils/               → Helpers (timezone, validation, constants)
extensions/              → Theme extensions (pickup scheduler, subscribe widget)
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
| `order-management.server.ts` | Order sync with Shopify |
| `google-calendar.server.ts` | Calendar event sync |
| `migration.server.ts` | Import existing orders/subscriptions |

## Important Notes

1. **Timezone**: All dates use Pacific Time (`America/Los_Angeles`). See `app/utils/timezone.server.ts`.
2. **Selling Plan Scopes**: `read/write_selling_plan_groups` scopes do NOT exist. Use `write_products`.
3. **Theme Extension Caching**: Shopify CDN caches assets. Clear browser cache after deploy.
4. **App Proxy**: Configured at `/apps/my-subscription`. Shopify strips subpath when forwarding.
5. **Test Store**: `aheajv-fg.myshopify.com` (TEST theme). **Live Store**: `susiessourdough.com`
6. **Webhook attributes**: Shopify REST webhooks use `name` (not `key`) for note_attributes.
7. **Date parsing**: Checkout extension formats dates as "Wednesday, February 25" (no year). Webhook handler infers year.

## Database Migrations

```bash
npx prisma migrate dev --name migration_name   # Local
npx prisma migrate deploy                       # Production (Railway runs this)
npx prisma generate                             # Regenerate client
```

## Deploying

1. Commit and push to `funny-leakey` → Railway auto-deploys backend
2. Theme extension changes also need: `npx shopify app deploy` + `npx shopify app release`

## Known Issues (Resolved)

- **Duplicate subscription widgets**: Caused by products in multiple Selling Plan Groups. Fixed by consolidating to one group per product.
- **COD + subscriptions incompatible**: Disabled COD. Shopify requires auto-chargeable payment methods for subscriptions.
- **Shopify Functions**: Payment customization functions require Shopify Plus ($399/mo). Not available on Basic plan.

## SSMA Subscription Plan Groups (v2)

Group-based subscription model (replaces flat `SubscriptionPlan`):
- `SubscriptionPlanGroup` → contains name, billingLeadHours, isActive
- `SubscriptionPlanFrequency` → child of group (interval, discount, discount code, shopifyDiscountId)
- `SubscriptionPlanProduct` → child of group (shopifyProductId, title, imageUrl)
- App proxy: `/apps/my-subscription/selling-plans?shop=...` returns groups + flat plans for cart widget
- Settings UI: Plan Groups at top, debug/legacy sections collapsed at bottom
- Auto-discount sync: Adding/updating frequencies auto-creates Shopify discount codes
- Cart widget: Dynamically fetches plans from API, applies/removes discount codes programmatically
- Service: `subscription-plans.server.ts` — full CRUD, `ensureDefaultPlanGroups()` seeds on first load

## Polaris Gotchas

- `Badge` does NOT have `tone="subdued"` — use no tone for neutral
- `InlineStack` uses `blockAlign` not `blockAlignment`
- Numbers in Badge/Button children must be template literals (`` `${count}` ``)

## Related Docs

- `CHANGE_HISTORY.md` - Detailed change log with file lists
- `PRODUCTION_TRANSITION_PLAN.md` - Production rollout plan
