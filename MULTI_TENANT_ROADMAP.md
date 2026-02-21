# Multi-Tenant Roadmap

> Track changes needed to offer this app to other cottage bakers.
> Items marked ✅ are done. Update this file as work progresses.

## Phase 1: BLOCKING — Must Fix Before Offering to Others

- [ ] **Remove hardcoded "Susie's Sourdough" from customer-facing text**
  - `app/services/notifications.server.ts` — SMS template, email subject, email footer, SendGrid "from" name
  - `app/routes/app.settings.notifications.tsx` — Default template constants
  - `app/routes/apps.my-subscription.tsx` — HTML title tag
  - Fix: Add `businessName` + `fromEmail` fields to `NotificationSettings` model (or new `ShopConfig` table). Use shop name as fallback.

- [ ] **Remove hardcoded Railway URLs from customer extensions**
  - `extensions/customer-account-profile/src/ProfileBlock.tsx` line 35
  - `extensions/customer-account-page/src/hooks/useSubscriptionApi.ts` line 6
  - Fix: Use env var or Shopify metafield. Known limitation: `extension.appUrl` unavailable on customer account extensions.

- [ ] **Make bakery schedule configurable per shop**
  - `app/routes/app.calendar.tsx` lines 35-49 — `DAY_HEADERS` and `PREP_TO_BAKE_DAYS` hardcoded
  - Fix: New `BakeryScheduleConfig` table with per-shop day labels and prep→bake day mappings. Settings UI to configure.

- [ ] **Remove hardcoded app name from admin UI**
  - `app/routes/app._index.tsx` — TitleBar shows "Susie Sourdough Dashboard"
  - `extensions/purchase-options-admin/src/ActionExtension.tsx` — Error text references "Susies Sourdough Manager"
  - Fix: Use generic app name or fetch shop name from Shopify API.

- [ ] **Per-shop SendGrid from-email**
  - Currently env var `SENDGRID_FROM_EMAIL` = `orders@susiessourdough.com`
  - Fix: Add `fromEmail` field to `NotificationSettings`. Fall back to env var if not set.

- [ ] **Change app distribution mode**
  - `app/shopify.server.ts` line 33 — `distribution: AppDistribution.SingleMerchant`
  - Fix: Change to `AppStore` for public, or keep `SingleMerchant` for private/unlisted sharing.

## Phase 2: IMPORTANT — Should Fix for Good Multi-Tenant Experience

- [ ] **Replace Susie-specific placeholder text**
  - `app/routes/app.settings.locations.tsx` — "Olivenhain Porch Pick-up" and Encinitas address as examples
  - `prisma/schema.prisma` — Comments reference Olivenhain/Encinitas
  - Fix: Use generic examples like "Downtown Location" / "123 Main St".

- [ ] **Per-shop timezone configuration**
  - `app/utils/timezone.server.ts` — Hardcoded `America/Los_Angeles`
  - Fix: Add timezone field to shop config. Default to Pacific for existing shops.

- [x] **Remove hardcoded Railway URL fallbacks** ✅ Done
  - `app/services/webhook-registration.server.ts` — Now throws if `SHOPIFY_APP_URL` not set
  - `app/routes/app.debug.webhooks.tsx` — Shows "(SHOPIFY_APP_URL not set)" instead of stale URL

- [ ] **Per-shop Twilio/SendGrid accounts (optional)**
  - Currently all shops share one Twilio + SendGrid account via env vars
  - Fix: Store API keys per shop in encrypted DB fields. Fall back to shared env vars for MVP.

## Phase 3: NICE-TO-HAVE — For Scale

- [ ] **Redis for rate limiting** — In-memory Map resets on cold start. Works for single-shop; needs Redis for many concurrent shops.
- [ ] **CORS restriction** — Currently `*` on customer API. Restrict to `${shop}.myshopify.com` per request.
- [ ] **Redis for caching** — Email cache and selling plan cache are in-memory Maps. Already properly keyed by shop.
- [ ] **Per-shop custom branding** — Logo, colors, business name for admin UI and customer portal.
- [ ] **Database read replicas** — For high query volume with many shops.

## What's Already Good ✅

- ✅ **Database isolation** — Every query filters by `shop`. All tables have `@@index([shop])` and `@@unique([shop, ...])` constraints.
- ✅ **Webhook handlers** — Extract shop from authenticated session. Properly scoped.
- ✅ **Cron job** — Iterates unique shops from DB. Works for any number of shops.
- ✅ **Rate limiter keys** — Include shop name in key. Properly isolated per shop.
- ✅ **Customer API** — Verifies shop from session token. Per-shop data only.
- ✅ **Settings pages** — All filter by shop. Each shop has independent config.
- ✅ **Google Calendar auth** — Per-shop in `GoogleCalendarAuth` table.
- ✅ **Subscription billing** — Per-shop billing cycles and lead time config.

## Estimated Effort

| Phase | Hours | When |
|-------|-------|------|
| Phase 1 (Blocking) | 5-8 hrs | Before offering to others |
| Phase 2 (Important) | 2-3 hrs | Before or shortly after |
| Phase 3 (Scale) | 4-6 hrs | When traffic demands it |
