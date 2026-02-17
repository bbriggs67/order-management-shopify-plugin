# Change History

> Add new entries at the TOP of this list. Include date, brief description, and files changed.

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
