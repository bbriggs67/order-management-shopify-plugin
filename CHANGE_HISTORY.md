# Change History

> Add new entries at the TOP of this list. Include date, brief description, and files changed.

### 2026-02-16 - Trim CLAUDE.md & SSMA Subscription Plans Feature

**Context:**
Claude Code "prompt too long" error caused by 825-line CLAUDE.md being loaded into system prompt.

**Changes:**
- Trimmed CLAUDE.md from 825 lines to ~93 lines (essential developer context only)
- Moved change history, test plans, and migration plan references to separate files
- Created `CHANGE_HISTORY.md` (this file) for detailed change log

**SSMA Subscription Plans (in progress):**
- New `SubscriptionPlan` Prisma model (SSMA-owned, not tied to Shopify Selling Plans)
- Service layer: `app/services/subscription-plans.server.ts` (CRUD, validation, defaults)
- API endpoint updated: `app/routes/api.selling-plans.tsx` (reads SSMA plans first, legacy fallback)
- Settings page: backend action handlers for create/update/delete plans
- Subscription service: accepts `discountPercent` and `billingLeadHours` overrides
- Constants: moved billing constants to shared module, added TRIWEEKLY

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
