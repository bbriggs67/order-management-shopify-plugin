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
- Customer CRM with notes, order history, and Shopify sync

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
| `subscription-billing.server.ts` | Billing processor, lead time calc, retry logic |
| `selling-plans.server.ts` | Shopify Selling Plan Groups sync (SSMA v2 only) |
| `pickup-availability.server.ts` | Available dates/times calculation |
| `google-calendar.server.ts` | Calendar event sync |
| `customer-crm.server.ts` | Customer CRM: search, detail, notes, Shopify sync |
| `draft-orders.server.ts` | Draft order creation + invoice sending (email/SMS) |
| `notifications.server.ts` | SMS (Twilio) + Email (SendGrid) sending |
| `sms-conversation.server.ts` | Two-way SMS: conversation CRUD, inbound recording |

## Subscription Flow (SSMA-Controlled)

**Product page** → SSMA widget shows "One-time purchase" + "Subscribe & Save" options
→ Customer selects frequency → clicks Add to Cart
→ Widget intercepts submit → `/cart/add.js` → `/cart/update.js` (sets SSMA attributes incl. discount %) → navigates to `/cart`
→ **Cart page** → only date/time picker (subscription widget skips since attributes set)
→ **Checkout** → Discount Function reads cart attributes → applies % discount automatically → webhook reads SSMA cart attributes → creates subscription

**Discount pipeline (Shopify Function):**
1. Product widget sets cart attributes: `Subscription Enabled`, `Subscription Frequency`, `Subscription Discount` (percentage)
2. Shopify Discount Function (`subscription-discount` extension) reads `Subscription Discount` attribute at checkout
3. Function applies percentage discount to all cart lines automatically — no discount codes needed
4. Checkout UI extension (`Checkout.tsx`) exists but does NOT render on one-page checkout. Discount Function works regardless.

**Two theme extension widgets:**
- `subscribe-save-product.js/css/liquid` — Product page (primary subscription selector + hides express checkout + hides native selling plan selector)
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
9. **Express checkout hidden on product pages** via CSS in `subscribe-save-product.css` (Shop Pay, Apple Pay, Google Pay bypass cart/date-picker flow).
10. **Discounts via Shopify Function**: `subscription-discount` extension reads cart attribute `Subscription Discount` (percentage) and applies automatically at checkout. No discount codes or URL params needed. Legacy `shopify-discounts.server.ts` deleted.
11. **Billing lead time**: Default is **85 hours** (~3.5 days before pickup). Constant in `constants.ts`. First subscription order is paid at checkout (no double-billing); recurring billing starts from second pickup.
12. **Calendar print**: Daily view has a Print button that opens a new window with clean printable layout (prep summary, pickups by time slot, extra orders).
13. **Customer CRM portal**: 5th admin page (`/app/customers`). Customer model synced from Shopify via webhook + manual sync. Detail page shows orders (collapsible), subscriptions, admin notes with categories, Shopify contact info. Notes can sync to Shopify customer note field.
14. **CRM Draft Orders**: Create Shopify draft orders from customer profile via product picker. Invoice sending modal: Shopify email, SMS (Twilio), or copy link. Service in `draft-orders.server.ts`.
15. **CRM Communication**: In-app email compose (SendGrid) and SMS compose (Twilio) modals on customer profile. Falls back to `mailto:`/`sms:` links when integrations not configured.
16. **CRM Notes cross-page**: Pinned customer notes display on Order and Subscription detail pages (sidebar). "View Profile" links on both pages.
17. **Two-way SMS**: iMessage-style conversation on customer detail page. Outbound via Twilio, inbound via webhook at `/api/twilio-webhook`. `SmsMessage` model tracks all messages. Polling every 10s when conversation expanded. Twilio number: `+18582484996`.
18. **Twilio webhook**: `/api/twilio-webhook` validates Twilio signature (HMAC-SHA1), rate-limited 60/min per IP. Returns empty TwiML. Dedup by `twilioSid`.
19. **A2P 10DLC**: Required for US SMS. Registration in progress — Privacy Policy (automated) and Terms of Service (custom with SMS terms) published at `susiessourdough.com/policies/`. Policy page CSS fix applied to both TEST and Dawn themes. Messages may be carrier-filtered until registration approved.
20. **Business location**: Encinitas, CA (not Poway). Contact is email-only: info@susiessourdough.com — no phone number on public pages.
21. **WebhookEvent TTL**: Payloads stripped to `{}` on creation. Records older than 30 days auto-deleted by hourly cron. Only idempotency key (`shop+topic+shopifyId`) is retained.
22. **Customer stats live from Shopify**: `totalOrderCount`, `totalSpent`, `currency` removed from DB. Fetched live via `numberOfOrders` + `amountSpent` in `getCustomerDetail()` GraphQL query. Customer list page does not show these columns.
23. **DB CHECK constraints**: `discountPercent` (0-100), `preferredDay` (0-6), `dayOfWeek` (0-6), `billingLeadHours` (1-168), `quantity` (>0) enforced at DB level. `PickupSchedule` FK relations use `onDelete: SetNull` to preserve history.
24. **Prisma enums**: `SubscriptionFrequency` (WEEKLY/BIWEEKLY/TRIWEEKLY) and `BillingAttemptStatus` (PENDING/SUCCESS/FAILED) enforce valid values at DB level. No more freeform strings for these fields.
25. **Customer cancel syncs Shopify**: `customerCancelSubscription` now calls `subscriptionContractCancel` mutation to keep Shopify contract in sync with local DB. Errors logged in admin notes.
26. **Billing race condition guard**: `processSingleBilling` re-checks subscription status before calling Shopify billing API, preventing charges on just-paused subscriptions.
27. **SMS phone lookup optimized**: `Customer.phoneNormalized` (E.164 indexed) replaces full-table scan in `recordInboundSMS`. Populated during customer upsert.

## SSMA Subscription Plan Groups (v2)

- `SubscriptionPlanGroup` → name, billingLeadHours, isActive
- `SubscriptionPlanFrequency` → interval, discount, discount code
- `SubscriptionPlanProduct` → shopifyProductId, title, imageUrl
- API: `/apps/my-subscription/selling-plans?shop=...` returns groups + flat plans
- Auto-sync: Adding/updating frequencies auto-syncs selling plans to Shopify
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

## Cold-Start Resilience

Railway may sleep after days of inactivity. Architecture handles this:

- **Prisma connection pool**: `connection_limit=5`, `connect_timeout=30s`, `pool_timeout=30s` (configured in `db.server.ts`)
- **DB warmup**: Async `SELECT 1` on server startup pre-warms connections (`shopify.server.ts`)
- **Health endpoint**: `GET /health` — returns DB status + latency. Used by external uptime monitor
- **Webhook retry**: `withRetry()` in `webhooks.orders.create.tsx` — exponential backoff for transient DB failures
- **Hourly cron**: GitHub Actions (`.github/workflows/subscription-cron.yml`) calls `/api/cron/process-subscriptions` hourly + health check keep-alive. Requires `RAILWAY_APP_URL` and `CRON_SECRET` GitHub Secrets

## Polaris Gotchas

- `Badge` does NOT have `tone="subdued"` — use no tone for neutral
- `InlineStack` uses `blockAlign` not `blockAlignment`

## Related Docs

- `CHANGE_HISTORY.md` - Detailed change log with file lists
- `PRODUCTION_TRANSITION_PLAN.md` - Production rollout plan
- `SHOPIFY_COMPLIANCE.md` - Shopify Dev Docs compliance report & known non-blocking issues
