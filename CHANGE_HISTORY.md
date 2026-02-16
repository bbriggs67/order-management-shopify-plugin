# Change History

> Add new entries at the TOP of this list. Include date, brief description, and files changed.

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
