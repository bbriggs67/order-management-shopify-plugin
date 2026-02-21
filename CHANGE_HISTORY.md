# Change History

> Add new entries at the TOP of this list. Include date, brief description, and files changed.

### 2026-02-21 - CRM Phases 3-6: Navigation, Draft Orders, Communication, Notes

**Phase 3: Cross-page navigation (commit 1f00713)**
- "View Profile" buttons on Order and Subscription detail pages → links to CRM customer profile
- Customer lookup by email in loaders for both pages
- Fixed order link to use `shopifyOrderId` instead of internal `id`

**Phase 4: Draft Orders from CRM (commit ba7bf57)**
- New `app/services/draft-orders.server.ts` — `createDraftOrder()`, `sendDraftOrderInvoice()`, `sendPaymentLinkViaSMS()`
- "Create Order" button on customer profile → Shopify product picker modal with quantity controls
- Invoice Sending modal with 3 options: Shopify invoice email, SMS via Twilio, copy payment link
- Loader passes `isTwilioConfigured` and `isSendGridConfigured` flags
- Action intents: `createDraftOrder`, `sendInvoice`
- Exported `sendSMS` from `notifications.server.ts`
- Scopes deployed: `shopify app deploy` → `susies-sourdough-manager-82`

**Phase 5: In-app Email & SMS Compose (commit 1cd136f)**
- Email Compose modal: subject + body → SendGrid via `sendEmail()`
- SMS Compose modal: message with character count → Twilio via `sendSMS()`
- Smart button fallback: in-app modals when integrations configured, `mailto:`/`sms:` links when not
- Action intents: `composeEmail`, `composeSMS`
- Exported `sendEmail` from `notifications.server.ts`

**Phase 6: Customer Notes on Detail Pages (commit 67bf7a1)**
- Pinned CRM notes displayed in sidebar of Order and Subscription detail pages
- Green background, category badges, "Manage" link to CRM profile
- Loader queries `Customer.notes` where `isPinned=true` via email lookup
- Notes sync to Shopify already functional via "Sync to Shopify" button on CRM profile

**New Files:**
- `app/services/draft-orders.server.ts` — Draft order service

**Modified Files:**
- `app/routes/app.customers.$customerId.tsx` — Create Order modal, Invoice Sending modal, Email/SMS Compose modals, integration flags
- `app/routes/app.orders.$orderId.tsx` — Customer notes in sidebar, View Profile link
- `app/routes/app.subscriptions.$contractId.tsx` — Customer notes in sidebar, View Profile link
- `app/services/notifications.server.ts` — Exported `sendSMS` and `sendEmail`

---

### 2026-02-21 - CRM Sync Fixes (3 commits)

**Fix 1 (commit fb95386):** Wrong Shopify GraphQL field names
- `ordersCount` → `numberOfOrders`, `totalSpentV2` → `amountSpent`
- Fixed sync banner: `navigation.formData` → `useActionData`
- Fixed webhook customer GID construction

**Fix 2 (commit 76df6ac):** Sync only finding local data
- Rewrote `syncCustomersFromLocalData()` to fetch from Shopify Customers API directly (Phase 1)
- Phase 2 fills gaps from local PickupSchedule/SubscriptionPickup data
- Fixed Prisma filter: `AND: [{ customerEmail: { not: null } }, { customerEmail: { not: "" } }]`

**Fix 3:** Scopes not activated — required `shopify app deploy` → `susies-sourdough-manager-82`

**Modified Files:**
- `app/services/customer-crm.server.ts` — Field names, two-phase sync
- `app/routes/app.customers._index.tsx` — Sync banner fix
- `app/routes/webhooks.orders.create.tsx` — Customer GID construction

---

### 2026-02-21 - Customer CRM Portal (Phase 1-2)

**Context:** Customer data was scattered across Orders and Subscriptions pages with no unified view. Added a Customer Management portal as the 5th admin page in SSMA.

**New Prisma Models:**
- `Customer` — local cache of Shopify customer data (shopifyCustomerId, email, name, phone, totalOrderCount, totalSpent, tags). Unique on `[shop, shopifyCustomerId]` and `[shop, email]`.
- `CustomerNote` — admin notes per customer with category (Preference/Family/Allergy/Delivery/General), pinning, and Shopify sync flag.

**New Service (`app/services/customer-crm.server.ts`):**
- `searchCustomers()` — paginated search with sort, enriched with subscription counts and last order dates
- `getCustomerDetail()` — local data + Shopify GraphQL enrichment (note, tags, addresses)
- `upsertCustomer()` — create/update from webhook data, handles email conflicts
- `syncCustomersFromLocalData()` — one-time migration from existing PickupSchedule + SubscriptionPickup data
- Note CRUD: `addCustomerNote`, `updateCustomerNote`, `deleteCustomerNote`, `togglePinNote`
- `syncNotesToShopify()` — push pinned notes to Shopify customer note field

**Customer List Page (`app/routes/app.customers._index.tsx`):**
- Search by name, email, or phone
- Sortable columns: Customer, Email, Phone, Orders, Subscriptions, Last Order, Total Spent
- Cursor-based pagination
- "Sync Customers from Shopify" button

**Customer Detail Page (`app/routes/app.customers.$customerId.tsx`):**
- Two-column layout following `app.subscriptions.$contractId.tsx` pattern
- Main section: Actions (Send Email/Text), Orders (collapsible, shows 3 by default), Subscriptions, Notes (CRUD with categories, pinning, Shopify sync)
- Sidebar: Contact Info, Customer Stats, Shopify Tags, Shopify Note
- Note Add/Edit modal with category selector

**Webhook Enhancement:**
- `webhooks.orders.create.tsx` now calls `upsertCustomer()` after order processing to keep Customer model current

**API Scopes:**
- Added `write_customers`, `read_draft_orders`, `write_draft_orders` (requires `shopify app deploy`)

**New Files:**
- `app/types/customer-crm.ts` — TypeScript interfaces for CRM
- `app/services/customer-crm.server.ts` — CRM service layer
- `app/routes/app.customers._index.tsx` — Customer list page
- `app/routes/app.customers.$customerId.tsx` — Customer detail page
- `prisma/migrations/20260221_add_customer_crm/migration.sql` — Customer + CustomerNote tables

**Modified Files:**
- `prisma/schema.prisma` — Added Customer + CustomerNote models
- `app/routes/app.tsx` — Added Customers nav link (between Calendar and Settings)
- `app/routes/webhooks.orders.create.tsx` — upsertCustomer call
- `shopify.app.susies-sourdough-manager.toml` — New API scopes
- `CLAUDE.md` — CRM service + note #13
- `CHANGE_HISTORY.md` — This entry

---

### 2026-02-21 - Billing Lead Time 85h + Calendar Print

**Fix 1: Billing lead time default changed from 48h to 85h (~3.5 days)**
- User reported Settings page showing "48 hours" but requirement was 85 hours
- Updated constant `DEFAULT_BILLING_LEAD_HOURS` from 48 → 85
- Updated all hardcoded fallbacks across subscription services
- Updated Prisma schema defaults for both `SubscriptionPlanGroup` and `SubscriptionPickup`
- Created migration to update existing DB records from 48/84 → 85
- Updated Settings page UI text and modal defaults

**Fix 2: Confirmed first subscription order is NOT double-billed**
- First order is paid at checkout; `nextBillingDate` is set to before the second pickup
- Billing cron only processes when `nextBillingDate <= now`
- Idempotency logging prevents duplicate charges

**Feature: Print button on Calendar day view**
- Print button in day navigation header opens a new window with clean print layout
- Includes dough prep summary (on prep days), pickups by time slot, and extra bake orders
- Auto-triggers `window.print()` on load
- Clean table format optimized for paper printing

**Files Modified:**
- `app/utils/constants.server.ts` — DEFAULT_BILLING_LEAD_HOURS: 48 → 85
- `prisma/schema.prisma` — Default values updated to 85
- `prisma/migrations/20260221_billing_lead_hours_85/migration.sql` (NEW)
- `app/services/subscription-plans.server.ts` — Fallback defaults to 85
- `app/services/subscription.server.ts` — Fallback defaults to 85
- `app/routes/app.settings.subscriptions.tsx` — UI text and modal defaults to 85
- `app/routes/apps.selling-plans.tsx` — Legacy fallback to 85
- `app/routes/api.selling-plans.tsx` — Legacy fallback to 85
- `app/routes/app.calendar.tsx` — Print button + buildPrintHtml helper

---

### 2026-02-20 - Prep, Bake & Pick-up Calendar

**Context:** Calendar was a simple monthly grid showing pickup counts per day. Susie needed it to be the
working calendar for managing bakery production — what to prep, bake, and pick up.

**New features:**
- **Monthly view** (enhanced): Day headers (Dough Prep Day / Bake Day / Day Off), clickable days → day view, pickup + extra order count badges, condensed prep summaries on prep days
- **Weekly view** (new): Mon–Sun columns, condensed (product totals) and expanded (full order detail) toggle, prep summaries on Mon/Thu
- **Day view** (new): Pickups grouped by time slot with full product line items, extra bake order list + add/remove form, prominent Dough Prep Summary on Mon/Thu
- **Dough Prep Summary**: Reusable component aggregating products across bake days (Mon→Tue+Wed, Thu→Fri+Sat), includes both pickups and extra bake orders
- **Extra Bake Orders**: New `ExtraBakeOrder` model for manually-added items (Shopify product picker), stored in DB, included in prep summaries
- **View selector**: Polaris Tabs (Monthly/Weekly/Daily) with per-view navigation

**Files changed:**
- `prisma/schema.prisma` — Added `ExtraBakeOrder` model
- `prisma/migrations/20260220_add_extra_bake_order/migration.sql` — New migration
- `app/routes/app.calendar.tsx` — Complete rewrite (~1500 lines): loader with view-based date ranges, orderItems include, extra orders, prep summaries; action handler for add/remove extra orders; MonthView, WeekView, DayView, DoughPrepSummary, DayHeaderBadge components

---

### 2026-02-20 - Cold-Start Resilience (commit a3057e4)

**Context:** Customer orders are mostly subscriptions with 4-6 day gaps between orders.
Railway sleeps the service during inactivity, causing cold-start failures when webhooks arrive.

**Fix 1: Prisma connection pooling**
- `db.server.ts` now appends `connection_limit=5`, `connect_timeout=30`, `pool_timeout=30` to DATABASE_URL
- Prevents stale connection errors after days of idle

**Fix 2: Database warmup on startup**
- `shopify.server.ts` calls `warmDatabaseConnection()` (async `SELECT 1`) at module load
- Pre-warms the connection pool before the first real request

**Fix 3: Enhanced health check**
- `health.tsx` now returns DB latency, server uptime, and `Cache-Control: no-store`

**Fix 4: Webhook retry logic**
- Added `withRetry()` helper to `webhooks.orders.create.tsx` with exponential backoff (500ms → 1s → 2s)
- Only retries transient errors (Prisma P1001/P1002/P1008/P1017, ECONNRESET, etc.)
- Wraps idempotency checks and pickup schedule creation

**Fix 5: GitHub Actions cron for subscription billing**
- New workflow `.github/workflows/subscription-cron.yml` runs hourly
- Calls `/api/cron/process-subscriptions` with Bearer token + `/health` keep-alive
- Requires GitHub Secrets: `RAILWAY_APP_URL`, `CRON_SECRET` (both configured)

**Files Modified:**
- `app/db.server.ts` — Connection pool config + `warmDatabaseConnection()` export
- `app/shopify.server.ts` — DB warmup call on startup
- `app/routes/health.tsx` — DB latency + uptime tracking
- `app/routes/webhooks.orders.create.tsx` — `withRetry()` wrapper on DB operations
- `.github/workflows/subscription-cron.yml` (NEW) — Hourly cron + keep-alive
- `CLAUDE.md` — Cold-Start Resilience section added

---

### 2026-02-20 - Sortable Columns + Order Date on Orders Page (commit 569a53a)

**Context:** Orders & Pickups table had no user-sortable columns and no Order Date.

**Changes:**
- Server-side sorting via URL params (`sort` and `direction`) with validated field mapping
- Columns Order #, Order Date, Customer, Pickup Date are now sortable (click column header)
- New "Order Date" column using `createdAt` field from PickupSchedule
- Pagination cursor resets on sort/filter/search changes
- Default sort: Pickup Date descending

**Files Modified:**
- `app/routes/app.orders._index.tsx` — Sortable DataTable + Order Date column

---

### 2026-02-20 - Code Review Round 3: Low-Priority Cleanup (commit 63e68a0)

10 fixes across extensions and backend:
- Unused imports, loading skeletons, retry buttons, type safety
- PII logging reduction, parseFloat for discount precision
- Removed unused locale keys, customer email from API response

See MEMORY.md for full item-by-item list (#18-#29).

**Files Modified:**
- `extensions/customer-account-page/src/components/PauseModal.tsx`
- `extensions/customer-account-profile/src/ProfileBlock.tsx`
- `extensions/customer-account-page/src/SubscriptionPage.tsx`
- `extensions/pickup-scheduler-cart/assets/pickup-scheduler.js`
- `extensions/pickup-scheduler-cart/assets/subscribe-save.js`
- `extensions/pickup-scheduler-cart/locales/en.default.json`
- `app/routes/webhooks.orders.create.tsx`
- `extensions/purchase-options-admin/src/ActionExtension.tsx`
- `app/routes/api.customer-subscriptions.tsx`

---

### 2026-02-20 - Code Review Rounds 1 & 2 (commits 3dd1ef7, 189bbc1)

**Round 1 (8 critical fixes):** Cart attribute merge, billing idempotency, timezone bugs (4 files), checkout validation, submitting guard timeout.

**Round 2 (9 medium fixes):** Reschedule filtering, TRIWEEKLY gaps, one-time reschedule cleanup, shopifyContractId update, error responses, express checkout hidden, email cache bounds, frequency validation, input sanitization.

See MEMORY.md for full item-by-item list (#1-#17).

---

### 2026-02-20 - Fix Order Tags, Calendar, and Orders Page for Subscription Orders

**3 issues from live test order #1865:**

**Fix 1: Shopify order tags not populated**
- Webhook handler never wrote tags to Shopify orders after creation.
- Added `tagsAdd` GraphQL mutation after creating PickupSchedule.
- Tags now include: time slot, pickup date, day of week, and "Subscription" flag.

**Fix 2+3: SSMA Orders page and Calendar empty**
- Root cause: When subscription order had no pickup date/time in cart attributes,
  the webhook took an early-return path that created a `SubscriptionPickup` but
  NO `PickupSchedule`. Both Orders and Calendar pages query `PickupSchedule`.
- Fixed: Removed the early-return for subscription orders. Now falls through to
  the main processing path with fallback date (today) and time slot ("TBD") when
  cart attributes are missing. Always creates a `PickupSchedule` + `SubscriptionPickup`
  + future pickup schedules.

**Fix 4: TRIWEEKLY frequency calculation bug (from code review)**
- `calculateNextPickupDate()` used `frequency === "WEEKLY" ? 7 : 14` — TRIWEEKLY
  got 14 days instead of 21.
- Fixed in both `subscription.server.ts` and `subscription-billing.server.ts`.

**Fix 5: discountPercent Int → Float (compliance #1)**
- `SubscriptionPickup.discountPercent` was `Int`, truncating 2.5% to 2 for triweekly.
- Changed to `Float` in schema + created migration.

**Fix 6: Hardcoded discount defaults → DB lookup (compliance #3)**
- `createSubscriptionFromOrder()` and `createSubscriptionFromContract()` used hardcoded
  discount percentages. Now calls `findFrequencyByLabel()` to read from
  `SubscriptionPlanFrequency` table, with hardcoded fallback if DB lookup fails.

**Fix 7: subscription_contracts.update ignores TRIWEEKLY (compliance #4)**
- Only mapped `interval_count === 1` to WEEKLY, everything else defaulted to BIWEEKLY.
- Now properly maps: 1=WEEKLY, 3=TRIWEEKLY, default=BIWEEKLY.
- Also uses DB lookup for discount percent.

**Fix 8: restoreSelection() stale discountCode property (compliance #5)**
- `subscribe-save-product.js` `restoreSelection()` set `discountCode` instead of
  `sellingPlanId`, causing restored selections to miss the selling plan ID.

**Fix 9: Duplicate subscriptions from dual webhooks (compliance #6)**
- Both `orders/create` and `subscription_contracts/create` could create duplicate
  `SubscriptionPickup` records for the same order (different GIDs bypass unique constraint).
- Added 5-minute duplicate check in `subscription_contracts/create` webhook.

**New file:**
- `SHOPIFY_COMPLIANCE.md` — Shopify Dev Docs compliance report & known non-blocking issues

**Files Modified:**
- `app/routes/webhooks.orders.create.tsx` — Tags, fallback date, unified flow
- `app/services/subscription.server.ts` — TRIWEEKLY fix, DB lookup for discounts
- `app/services/subscription-billing.server.ts` — TRIWEEKLY fix
- `app/routes/webhooks.subscription_contracts.update.tsx` — TRIWEEKLY + DB lookup
- `app/routes/webhooks.subscription_contracts.create.tsx` — Duplicate prevention
- `extensions/pickup-scheduler-cart/assets/subscribe-save-product.js` — restoreSelection fix
- `prisma/schema.prisma` — discountPercent Int → Float
- `prisma/migrations/20260220_discount_percent_float/migration.sql` (NEW)
- `CLAUDE.md` — Added reference to SHOPIFY_COMPLIANCE.md
- `SHOPIFY_COMPLIANCE.md` (NEW)

---

### 2026-02-16 - Critical Subscription Pipeline Fixes

**Root Cause Analysis:** Identified 3 compounding issues causing subscriptions to not
appear in SSMA after live test orders.

**Fix 1: Webhook note_attributes intermittently missing (known Shopify bug)**
- Shopify's `orders/create` webhook intermittently omits `note_attributes` when set
  via `/cart/update.js` (documented issue in Shopify developer forums).
- Added fallback: if webhook payload has no/incomplete attributes, re-fetch the order
  from Shopify GraphQL `customAttributes` before processing.

**Fix 2: Subscriptions page queried Shopify Contracts for SSMA-native subscriptions**
- The subscriptions list page (`app.subscriptions._index.tsx`) tried to fetch
  `SubscriptionContract` data from Shopify for every subscription — but SSMA-created
  subscriptions store order GIDs, not contract GIDs. Shopify returned null, causing
  empty product/price/frequency columns.
- Now only queries Shopify for actual `SubscriptionContract` GIDs.
- SSMA-native subscriptions show frequency/discount from the local DB instead.

**Fix 3: Frequency ordering on product page widget**
- All subscription plan frequencies had `sortOrder: 0` (default), causing
  unpredictable display order.
- Added `intervalCount` as secondary sort in `getActivePlanGroups()` so
  Weekly (1) < Bi-Weekly (2) < Tri-Weekly (3) always.

**Fix 4: Test Subscription debug tool**
- New debug page at `/app/debug/test-subscription` creates test SubscriptionPickup
  records and future pickups WITHOUT requiring a live Shopify order.
- Allows validating the full subscription pipeline before live testing.

**Files Modified:**
- `app/routes/webhooks.orders.create.tsx` — Re-fetch attributes fallback
- `app/routes/app.subscriptions._index.tsx` — SSMA-native subscription display
- `app/services/subscription-plans.server.ts` — intervalCount secondary sort
- `app/routes/app.debug.test-subscription.tsx` — NEW: test subscription tool

---

### 2026-02-16 - SSMA Product Page Subscription Widget

**Replaces Shopify's native selling plan selector** on the product page with an
SSMA-controlled subscription widget. This eliminates sync issues caused by Shopify
subscription contracts and keeps SSMA in full control of the subscription lifecycle.

**New flow:**
1. Product page → SSMA widget shows "One-time purchase" + "Subscribe & Save" options
2. Customer selects frequency → clicks Add to Cart
3. Widget intercepts submit → adds product via `/cart/add.js` → sets SSMA cart
   attributes → applies discount code → navigates to `/cart`
4. Cart page → only date/time picker (subscription widget skips since attributes set)
5. Checkout → webhook reads SSMA cart attributes → creates subscription

**Cart widget updated** to skip when SSMA subscription attributes are already
set from the product page widget (avoids duplicate subscription selection).

**New Files:**
- `extensions/pickup-scheduler-cart/blocks/subscribe-save-product.liquid`
- `extensions/pickup-scheduler-cart/assets/subscribe-save-product.js`
- `extensions/pickup-scheduler-cart/assets/subscribe-save-product.css`

**Modified Files:**
- `extensions/pickup-scheduler-cart/assets/subscribe-save.js` — Skip cart widget
  when SSMA attributes already set

---

### 2026-02-16 - Selling Plan Sync, Group Name, Pickup Date Timezone Fix

**Selling Plan Ordering:**
- Added `position` field to selling plans so product page shows correct order:
  Weekly (1) → Bi-Weekly (2) → Tri-Weekly (3).
- `syncSellingPlansFromSSMA` now sorts by intervalCount and passes position.

**Selling Plan Group Name Sync:**
- `syncSellingPlansFromSSMA` now updates the Shopify selling plan group name to match
  the SSMA plan group name (e.g. "Subscribe & Save - Porch Pick Up").

**Pickup Date Timezone Bug Fix:**
- Human-readable dates like "Tuesday, February 24" were parsed as midnight UTC via
  `new Date("February 24, 2026")`. In Pacific time, midnight UTC = previous day.
  Fixed by re-constructing parsed dates with `T12:00:00` (noon) like the ISO format paths.
- This also fixes `preferredDay` calculation and future pickup date generation since both
  depend on the correctly parsed pickup date.

**Auto-Sync Selling Plans:**
- Adding or editing SSMA frequencies now auto-syncs selling plans to Shopify
  (matching existing auto-sync for discount codes).

**Files Modified:**
- `app/services/selling-plans.server.ts` — Position field, group name sync, auto-sync
- `app/routes/webhooks.orders.create.tsx` — Pickup date timezone fix
- `app/routes/app.settings.subscriptions.tsx` — Sync selling plans button, auto-sync calls

---

### 2026-02-16 - Fix Discount Sync: Percentage Format & Error Reporting

**Bug Fix — Shopify discount codes not creating:**
- `buildDiscountInput()` in `shopify-discounts.server.ts` used a NEGATIVE percentage value
  (e.g. `-0.1` for 10%) but Shopify's `discountCodeBasicCreate` API requires a POSITIVE decimal
  (e.g. `0.1` for 10%). The GraphQL mutation was silently returning `userErrors`, leaving
  `shopifyDiscountId` as null. Fixed by removing the negation.

**Improvement — Sync error reporting:**
- `syncDiscountsForGroup()` and `syncAllDiscounts()` now return a `DiscountSyncResult` with
  counts of created/updated/deleted/failed and error messages.
- The `sync_discounts` action now surfaces failures to the UI instead of always reporting success.
  Shows detailed error messages when any frequency fails to sync.

**Files Modified:**
- `app/services/shopify-discounts.server.ts` — Fix percentage, add result tracking
- `app/routes/app.settings.subscriptions.tsx` — Use sync results for error/success messages

---

### 2026-02-16 - Cart Widget Bug Fix & Selling Plan Conflict Prevention

**Bug Fix — `fetchPlans()` not using API data:**
- `fetchPlans()` returned the entire API response object (`{enabled, groups, plans}`) instead of
  extracting the `plans` array. Since objects don't have `.length`, the condition `apiPlans.length > 0`
  always failed, falling back to hardcoded theme settings. Fixed by extracting `data.plans`.

**Selling Plan Conflict Prevention:**
- Added detection in `loadCartState()`: checks `cart.items[].selling_plan_allocation` to see if
  customer already selected a subscription on the product page via Shopify's native selling plan UI.
- If selling plan items are found, `init()` returns early — SSMA Subscribe & Save widget is NOT
  injected, avoiding duplicate subscription options on the cart page.
- Result: Product page subscription → cart shows only date/time picker (no duplicate widget).
  One-time purchase → cart shows SSMA Subscribe & Save widget + date/time picker.

**Files Modified:**
- `extensions/pickup-scheduler-cart/assets/subscribe-save.js`
- `CLAUDE.md`

---

### 2026-02-16 - Auto Discount Codes, Dynamic Cart Widget, Settings UI Cleanup

**Context:**
The cart widget was hardcoding discount codes (`SUBSCRIBE-WEEKLY-10`, etc.) that didn't exist in
Shopify. Users had to manually create them. This update makes everything seamless: SSMA auto-creates
discount codes, the cart widget dynamically reads frequencies from the API, and the settings page
is reorganized with debug sections collapsed.

**Why discount CODES (not automatic discounts):** Shopify automatic discounts apply to ALL customers
with eligible products. Since the same products can be bought one-time OR subscription, automatic
discounts would give everyone the discount. Discount codes applied/removed by the widget solve this.

**Schema Changes (migration: `20260216_add_shopify_discount_id`):**
- Added `shopifyDiscountId String?` to `SubscriptionPlanFrequency`

**New Service (`app/services/shopify-discounts.server.ts`):**
- Auto-creates/updates/deletes Shopify discount codes via GraphQL Admin API
- `generateDiscountCode()` — builds human-readable codes from interval info
- `createDiscountCodeForFrequency()` — creates discount + persists GID back to DB
- `syncDiscountsForGroup()` / `syncAllDiscounts()` — batch sync operations
- Codes auto-generated if `discountCode` is blank (e.g., `SUBSCRIBE-WEEKLY-10`)

**New App Proxy Route (`app/routes/apps.selling-plans.tsx`):**
- Accessible at `/apps/my-subscription/selling-plans?shop=...`
- Returns groups (v2 structured) + flat plans array with discount codes
- Legacy fallback to SellingPlanConfig
- CORS headers + 5-minute cache

**Cart Widget Rewrite (`extensions/.../assets/subscribe-save.js`):**
- Removed hardcoded `DISCOUNT_CODES` constant
- Added `fetchPlans()` — calls app proxy API, falls back to dev URL then theme settings
- Dynamically generates radio buttons from API response
- Each radio carries `data-discount-code` attribute from API
- Applies/removes discount codes programmatically based on selection

**Liquid Embed Update (`extensions/.../blocks/subscribe-save.liquid`):**
- Added `data-shop="{{ shop.permanent_domain }}"` for API calls
- Added `dev_url` setting + meta tag for development

**Settings Page (`app/routes/app.settings.subscriptions.tsx`):**
- Discount sync integrated into 6 action handlers (add/update/delete frequency, add/remove products, delete group)
- New `sync_discounts` action for manual full sync
- "Sync All Discounts" button in Plan Groups header
- Discount Code column shows sync status badges (Synced/Not synced)
- Frequency modal help text: "Leave blank to auto-generate"
- UI reorganized: Plan Groups moved to top (after banners/webhooks)
- "Action Required: Create Discount Codes" banner removed
- SSMA System card, Shopify Plans reference, Manual Sync moved to collapsible "Advanced / Debug" section
- Added discount scopes (`read_discounts,write_discounts`) to TOML config

**Files Modified:**
- `prisma/schema.prisma`
- `prisma/migrations/20260216_add_shopify_discount_id/migration.sql` (NEW)
- `app/services/shopify-discounts.server.ts` (NEW)
- `app/routes/apps.selling-plans.tsx` (NEW)
- `app/routes/app.settings.subscriptions.tsx`
- `extensions/pickup-scheduler-cart/blocks/subscribe-save.liquid`
- `extensions/pickup-scheduler-cart/assets/subscribe-save.js`
- `shopify.app.susies-sourdough-manager.toml`
- `CLAUDE.md`
- `CHANGE_HISTORY.md`

---

### 2026-02-16 - Subscription Plan Groups v2 (Group → Frequency → Product)

**Context:**
Restructured SSMA subscription plans from a flat model to a group-based hierarchy.
Each plan group (e.g., "Subscribe & Save - Porch Pick Up") contains multiple frequency
options and has products associated with it. Different groups can have different
frequencies and different product sets.

**Schema Changes (migration: `20260216_subscription_plan_groups`):**
- New models: `SubscriptionPlanGroup`, `SubscriptionPlanFrequency`, `SubscriptionPlanProduct`
- Dropped old flat `SubscriptionPlan` table
- Cascade deletes: removing a group removes its frequencies + products
- Unique constraints: `[groupId, interval, intervalCount]` on frequency, `[groupId, shopifyProductId]` on product

**Service Layer (`app/services/subscription-plans.server.ts`):**
- Full CRUD: groups, frequencies, products
- `ensureDefaultPlanGroups(shop)` seeds one group with 3 frequencies on first load
- `findFrequencyByInterval()` for webhook lookups (returns parent group's billingLeadHours)

**API (`app/routes/api.selling-plans.tsx`):**
- Returns `groups` (structured v2 format with productIds) + flat `plans` (backward compat)
- Source field: `"ssma_v2"` for new format, `"legacy"` for old SellingPlanConfig fallback

**Settings Page (`app/routes/app.settings.subscriptions.tsx`):**
- Group cards with name/badges, action buttons (Edit, Delete, Add Frequency, Add Products)
- DataTable of frequencies per group (Name, Frequency, Discount, Code, Status, Actions)
- Collapsible product list with thumbnails + Shopify Resource Picker integration
- 4 modals: Group create/edit, Frequency create/edit, Delete group confirm, Delete frequency confirm
- 8 action intents: create/update/delete_plan_group, add/update/delete_frequency, add_group_products, remove_group_product

**Code Cleanup:**
- Removed stale console.log calls from loader
- Fixed Polaris issues: `blockAlignment` → `blockAlign`, Badge number children
- Cleaned up unused type imports

**Files Modified:**
- `prisma/schema.prisma`
- `prisma/migrations/20260216_subscription_plan_groups/migration.sql` (NEW)
- `app/services/subscription-plans.server.ts`
- `app/routes/api.selling-plans.tsx`
- `app/routes/app.settings.subscriptions.tsx`
- `CLAUDE.md`
- `CHANGE_HISTORY.md`

---

### 2026-02-16 - Trim CLAUDE.md

**Context:**
Claude Code "prompt too long" error caused by 825-line CLAUDE.md being loaded into system prompt.

**Changes:**
- Trimmed CLAUDE.md from 825 lines to ~93 lines (essential developer context only)
- Moved change history, test plans, and migration plan references to separate files
- Created `CHANGE_HISTORY.md` (this file) for detailed change log

---

### 2026-02-15 - Webhook Bug Fixes, Migration Tools, and Code Cleanup

**Context:**
Testing revealed that subscription orders weren't being properly synced to SSMA. Investigation discovered multiple bugs and also that testing was being performed on the wrong theme/checkout system.

**Root Cause Analysis:**
1. **Theme Configuration Issue**: The live store has TWO checkout systems:
   - **Dawn theme (live)**: Uses Bird pickup scheduler + Shopify native subscriptions
   - **TEST theme**: Uses SSMA pickup scheduler + SSMA subscription backend
   - Orders placed through checkout were using Bird/Shopify systems, not SSMA
   - Theme must be published to test SSMA's checkout extension properly

2. **Webhook Attribute Parsing Bug (Fixed)**:
   - Shopify REST API webhook payloads use `"name"` for note_attributes, NOT `"key"`
   - Code was looking for `a.key` instead of `a.name`

3. **Date Parsing Bug (Fixed)**:
   - Checkout extension formats dates as "Wednesday, February 25" (without year)
   - Added year inference logic with past-date detection

**Bug Fixes:**
- `app/routes/webhooks.orders.create.tsx` - attribute parsing fix, date parsing
- `app/routes/webhooks.orders.updated.tsx` - same fixes

**Checkout Extension Target Changed:**
- Changed from `purchase.checkout.delivery-address.render-after` to `purchase.checkout.contact.render-after`
- Reason: Products with `requires_shipping=false` may skip delivery address section

**New Features:**
- Migration Service (`app/services/migration.server.ts`) - import existing orders/subscriptions
- Migration Admin Page (`app/routes/app.settings.migration.tsx`)
- Webhook Debug Page Enhancements (`app/routes/app.debug.webhooks.tsx`)

---

### 2026-02-14 - Duplicate Widget Root Cause Identified

**Root Cause:** Products associated with multiple Selling Plan Groups instead of ONE group containing multiple frequencies.

**Solution:** Consolidated into 3 properly-configured Selling Plan Groups where each product is in only ONE group.

---

### 2026-02-13 - Subscription Integration Fixes & Duplicate Widget Investigation

**Issues Fixed:**
1. Webhook URIs in TOML pointed to wrong paths
2. Subscribe-save widget was adding `properties` instead of `selling_plan` IDs
3. Created `app/routes/api.selling-plans.tsx` API endpoint

**Files Modified:**
- `shopify.app.susies-sourdough-manager.toml` - Fixed webhook URIs
- `app/routes/app.settings.subscriptions.tsx` - Manual sync feature
- `app/routes/api.selling-plans.tsx` - NEW

---

### 2026-02-08 - Code Audit & Security Improvements

1. Input validation (prep-times route) with min/max bounds
2. Orders page pagination & error handling
3. Environment variable validation (`app/utils/env.server.ts`)
4. Google Calendar retry logic with exponential backoff

---

### 2026-02-01 - COD Payment Issue Resolution

- COD incompatible with subscriptions (no auto-charge)
- Payment customization functions require Shopify Plus
- Resolution: Disabled COD entirely in Shopify Settings

---

### 2026-01-31 - Multiple Fixes

- **maxBookingDays**: Changed to use calendar days instead of available pickup dates
- **Theme cart.js fix**: Wrapped hidden inputs in fieldset with data attributes
- **Pickup validation**: Required date + time selection before checkout
- **Selling Plan Groups**: Fixed display loop with local config fallback

---

### Initial Release

- Subscription management with weekly/bi-weekly plans
- Customer self-service portal at `/apps/my-subscription`
- Pickup scheduling on cart page
- Admin configuration for pickup days, time slots, blackouts
- Order management dashboard
