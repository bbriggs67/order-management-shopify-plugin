# Susie's Sourdough Manager - Claude Code Context

This file provides context for Claude Code sessions working on this Shopify app.

> **IMPORTANT FOR CLAUDE**: When making any feature additions, modifications, bug fixes, or significant changes to this codebase, you MUST update this documentation file AND add an entry to the Change History section at the bottom. This ensures future sessions have accurate context.

## Quick Start

```bash
# Install dependencies
npm install

# Run locally (requires Shopify CLI)
npm run dev

# Deploy to Shopify
npx shopify app deploy --config shopify.app.susies-sourdough-manager.toml

# Release a version
npx shopify app release --version=VERSION_NAME --config shopify.app.susies-sourdough-manager.toml --allow-updates
```

## Project Overview

**Susie's Sourdough Manager** is a Shopify app for managing sourdough bread subscriptions with local pickup scheduling. It's built for a small bakery business with:

- Weekly/bi-weekly subscription plans with discounts
- Customer self-service subscription management portal
- Pickup date/time scheduling on cart page
- Configurable pickup days, time slots, and blackout dates
- Order management dashboard for the store owner

## Architecture

### Tech Stack
- **Framework**: Remix (Shopify App Template)
- **Database**: PostgreSQL via Prisma ORM
- **Hosting**: Railway (auto-deploys from `funny-leakey` branch)
- **Shopify**: App Bridge, Polaris UI, Theme Extensions

### Key Directories
```
app/
├── routes/           # Remix routes (pages & API endpoints)
│   ├── app.*.tsx     # Admin UI pages (embedded in Shopify admin)
│   ├── apps.*.tsx    # App proxy routes (customer-facing)
│   └── api.*.tsx     # Internal API endpoints
├── services/         # Business logic
├── utils/            # Helpers (timezone, validation, etc.)
└── db.server.ts      # Prisma client

extensions/
├── pickup-scheduler/           # Product page subscription widget
└── pickup-scheduler-cart/      # Cart page pickup date/time selector

prisma/
└── schema.prisma     # Database schema
```

## Key Features & Files

### 1. Subscription Management
- **Admin UI**: `app/routes/app.settings.subscriptions.tsx`
- **Service**: `app/services/selling-plans.server.ts`
- **Shopify Integration**: Uses Selling Plan Groups API (requires `write_products` scope)

### 2. Pickup Scheduling (Cart Page)
- **Theme Extension**: `extensions/pickup-scheduler-cart/`
- **API Endpoint**: `app/routes/apps.pickup-availability.tsx`
- **JavaScript**: `extensions/pickup-scheduler-cart/assets/pickup-scheduler.js`
- Validates date + time selection before checkout

### 3. Customer Subscription Portal
- **Route**: `app/routes/apps.my-subscription.tsx`
- **Service**: `app/services/customer-subscription.server.ts`
- Accessible via: `https://store.com/apps/my-subscription`
- Features: pause, resume, cancel, reschedule pickups

### 4. Pickup Configuration (Admin)
- **Pickup Days**: `app/routes/app.settings.pickup-days.tsx`
- **Time Slots**: `app/routes/app.settings.time-slots.tsx`
- **Blackout Dates**: `app/routes/app.settings.blackout-dates.tsx`
- **Prep Time/Lead Time**: `app/routes/app.settings.prep-time.tsx`

### 5. Order Dashboard
- **Route**: `app/routes/app.orders.tsx`
- Shows orders by pickup date with subscription details

## Shopify App Proxy

The app proxy is configured at `/apps/my-subscription`:
- Configured in `shopify.app.susies-sourdough-manager.toml`
- Forwards to Railway: `https://order-management-shopify-plugin-production.up.railway.app/apps`
- **Important**: Shopify strips the subpath when forwarding, so `/apps/my-subscription/pickup-availability` becomes `/apps/pickup-availability` on the server

## Database Schema (Key Models)

- `Session` - Shopify OAuth sessions
- `CustomerSubscription` - Active subscriptions with pickup preferences
- `PickupDayConfig` - Which days allow pickup (Tue, Wed, Fri, Sat)
- `TimeSlot` - Available pickup time windows per day
- `BlackoutDate` - Dates/times when pickup is unavailable
- `PrepTimeConfig` - Lead time requirements for orders
- `SellingPlanConfig` - Local cache of Shopify selling plan settings
- `PickupLocation` - Store pickup locations

## Common Tasks

### Deploying Changes
1. Commit and push to `funny-leakey` branch
2. Railway auto-deploys backend changes
3. For theme extension changes, also run:
   ```bash
   npx shopify app deploy --config shopify.app.susies-sourdough-manager.toml
   npx shopify app release --version=VERSION --config shopify.app.susies-sourdough-manager.toml --allow-updates
   ```

### Database Migrations
```bash
npx prisma migrate dev --name migration_name  # Local development
npx prisma migrate deploy                      # Production (Railway runs this)
```

### Testing the App
- **Test Store**: Uses `aheajv-fg.myshopify.com` (TEST - DO NOT PUBLISH theme)
- **Live Store**: `susiessourdough.com`

## Important Notes

1. **Timezone**: All dates/times use Pacific Time (`America/Los_Angeles`). See `app/utils/timezone.server.ts`.

2. **Selling Plan Scopes**: The scopes `read_selling_plan_groups` and `write_selling_plan_groups` do NOT exist. Selling plans are managed via `write_products` scope.

3. **Theme Extension Caching**: Shopify CDN caches theme extension assets. After deploying, users may need to clear browser cache or wait for CDN propagation.

4. **App Proxy Signature**: Customer-facing routes verify Shopify's HMAC signature. The `apps.pickup-availability.tsx` route skips this for public API access.

## Troubleshooting

### "Unable to load pickup times" on cart
- Check that `apps.pickup-availability.tsx` route exists
- Verify app proxy is configured in Shopify Partners dashboard
- Test directly: `curl https://susiessourdough.com/apps/my-subscription/pickup-availability?shop=SHOP_DOMAIN`

### Subscription plans not showing
- Check `SellingPlanConfig` in database has the shop's config
- Verify selling plan group exists in Shopify admin
- The app falls back to local config if Shopify API returns empty

### Calendar showing wrong month
- Calendar auto-advances to first available date's month
- Lead time settings affect which dates are available

---

## Change History

> **Instructions**: Add new entries at the TOP of this list. Include date, brief description, and files changed.

### 2026-02-14 - Duplicate Widget Root Cause Identified

**Context:**
Continued investigation of duplicate subscription widgets on product pages.

**Root Cause Discovered:**
Shopify has TWO separate systems rendering subscription options:
1. **Native Selling Plan UI** - Automatically injected by Shopify for products in Selling Plan Groups (no theme code required)
2. **Custom Subscribe & Save Widget** - Our app embed that injects via JavaScript

Both were active simultaneously, causing duplicates.

**Investigation Steps Completed:**
- Pulled and analyzed TEST theme code - confirmed NO `selling_plan` Liquid code exists
- Cleaned settings_data.json by removing Shopify Subscriptions and Bird Pickup Delivery entries
- Verified product.json template has no subscription blocks
- Researched Shopify documentation and community forums
- Confirmed Shopify's automatic selling plan UI behavior

**Solution:**
- **Option A (Recommended)**: Disable our custom "Subscribe & Save" widget in Theme Editor → App embeds, use Shopify's native UI
- **Option B**: Remove product from Selling Plan Groups, use only our custom widget
- **Option C**: Modify custom widget JS to detect and defer to native UI when present

**Files Modified:**
- `CLAUDE.md` - Updated Known Issues section with root cause and solutions

**References:**
- https://shopify.dev/docs/storefronts/themes/pricing-payments/subscriptions/add-subscriptions-to-your-theme
- https://community.shopify.com/c/shopify-discussions/subscription-options-appearing-twice-on-product-page/td-p/1294566

---

### 2026-02-13 - Subscription Integration Fixes & Duplicate Widget Investigation

**Context:**
User reported that subscription purchases weren't showing up in the Susies Sourdough Manager app (neither admin side nor customer portal). Investigation revealed multiple issues.

**Issues Identified & Fixed:**

1. **Webhook URIs Incorrect**
   - Webhook URIs in TOML were pointing to `/webhooks` but Remix routes expect specific paths
   - Fixed: Updated to `/webhooks/subscription_contracts/create`, `/webhooks/orders/create`, etc.

2. **Manual Sync Feature Added**
   - Added ability to manually sync subscriptions by order number (e.g., `#1829`)
   - Useful for recovering orders that weren't captured by webhooks
   - Added debug output showing line items, selling plans, custom attributes, tags

3. **Root Cause Discovery: Selling Plan IDs**
   - Discovered that the subscribe-save widget was adding `properties` (like `Subscription=Yes`) instead of actual `selling_plan` IDs
   - Properties are metadata only - they do NOT create Shopify subscription contracts
   - The `selling_plan` parameter is the KEY field that triggers Shopify to create a subscription contract

4. **API Endpoint for Selling Plans**
   - Created `app/routes/api.selling-plans.tsx` to expose selling plan IDs to the frontend
   - Returns plan IDs, frequencies, and discounts from the database

**Unresolved Issue: Duplicate Subscription Widgets**

After making changes to fix subscription integration, duplicate subscription widgets started appearing on product pages. Investigation revealed:

- Both widgets appear to be Shopify's native selling plan UI (not our custom widget)
- The duplicate persists even after reverting ALL code changes to pre-today state
- This confirms the duplicate is NOT caused by code changes

**Possible Causes to Investigate:**
1. Product associated with multiple Selling Plan Groups
2. Theme has duplicate selling plan picker blocks
3. Shopify Admin configuration changed (selling plans attached to products)
4. Theme settings_data.json has duplicate app embed entries
5. Another app (Bird Pickup Delivery, Sami B2B Lock remnants) injecting widgets

**Files Modified:**
- `shopify.app.susies-sourdough-manager.toml` - Fixed webhook URIs
- `app/routes/app.settings.subscriptions.tsx` - Added manual sync feature with debug output
- `app/routes/api.selling-plans.tsx` - NEW: API endpoint for selling plan IDs

**Files Temporarily Modified Then Reverted:**
- `extensions/pickup-scheduler-cart/assets/subscribe-save.js` - Attempted selling plan ID integration (reverted)
- `extensions/pickup-scheduler-cart/blocks/subscribe-save.liquid` - Attempted modifications (reverted)

**App Versions Released:** susies-sourdough-manager-37 through susies-sourdough-manager-42

**Next Steps - Duplicate Widget Investigation Plan:**
See "Known Issues" section below for detailed investigation plan.

---

## Known Issues

### Duplicate Subscription Widgets on Product Pages

**Status:** ✅ ROOT CAUSE FOUND & FIXED (2026-02-14)

**Root Cause:**
Products were associated with **MULTIPLE Selling Plan Groups** instead of ONE group containing multiple frequencies. Each Selling Plan Group renders its own widget, causing duplicates.

**Original Problem:**
- 3 separate Selling Plan Groups existed: "Weekly Subscription", "Pick up Every other week", "Pick up Every 3 Weeks"
- Products were added to multiple groups (e.g., a product in both Weekly AND Bi-weekly groups)
- Each group rendered its own subscription picker widget

**Solution Applied:**
Consolidate into **3 properly-configured Selling Plan Groups** where each product is in ONLY ONE group:

| Plan Group Name | Frequencies Included | Products |
|-----------------|---------------------|----------|
| Weekly Only | 1 week (10% off) | 1 product |
| Weekly + Bi-Weekly | 1 week (10% off), 2 weeks (5% off) | 11 products |
| Weekly + Bi-Weekly + Tri-Weekly | 1 week (10% off), 2 weeks (5% off), 3 weeks (2.5% off) | 3 products |

**Key Learning:**
- A Selling Plan Group can contain MULTIPLE delivery frequencies
- Each product should be in exactly ONE Selling Plan Group
- Shopify's native UI automatically renders all frequencies within a single group as one widget

---

## Susies Sourdough Manager App - Complete Test Plan

**Status:** READY FOR TESTING (2026-02-14)

> ⚠️ **CRITICAL: DO NOT MODIFY THE LIVE STORE**
> All testing must be done on a TEST theme and with TEST products only.
> The live Dawn theme and live products must remain untouched until full testing is complete.

### Current State

**Live Store (DO NOT TOUCH):**
- Using Shopify's native Subscriptions app
- Selling Plan Groups properly configured (one group per product)
- "Subscribe & Save (Porch Pick-Up Only)" title displays correctly
- Existing customer subscriptions are managed by Shopify Subscriptions

**Susies Sourdough Manager App Features (Not Yet Enabled on Live):**
- Pickup date/time scheduling (cart page widget)
- Flexible billing lead time (default 84 hours before pickup)
- Customer subscription portal (`/apps/my-subscription`)
- Pause/Resume/Cancel subscriptions
- One-time and permanent rescheduling
- Admin subscription dashboard
- Failed billing monitoring and retry
- Google Calendar integration

---

### Phase 1: Test Environment Setup

**DO THESE STEPS FIRST - All in Shopify Admin**

#### Step 1.1: Create TEST Theme
1. Go to **Online Store → Themes**
2. Click **"..." on Dawn (live)** → **Duplicate**
3. Rename to **"TEST - DO NOT PUBLISH"**
4. **DO NOT** publish this theme

#### Step 1.2: Create TEST Product
1. Go to **Products → Add product**
2. Set:
   - Title: `TEST Subscription Product - DO NOT PURCHASE`
   - Price: `$0.01`
   - Status: **Draft** (so customers can't find it)
   - Uncheck all sales channels except Online Store
3. Save the product
4. Note the product URL for testing (you can access draft products via direct URL)

#### Step 1.3: Create TEST Selling Plan Group
1. Go to **Apps → Subscriptions → Plans**
2. Click **Create plan**
3. Set:
   - Title: `TEST - Subscribe & Save (Porch Pick-Up Only)`
   - Internal description: `FOR TESTING ONLY - DO NOT USE WITH LIVE PRODUCTS`
4. Add frequencies:
   - 1 Week, 10% off
   - 2 Weeks, 5% off
   - 3 Weeks, 2.5% off
5. Add ONLY the TEST product to this plan
6. Save

#### Step 1.4: Configure TEST Theme App Embeds
1. Go to **Online Store → Themes → TEST - DO NOT PUBLISH → Customize**
2. Click **App embeds** (puzzle piece icon in left sidebar)
3. Find **Susies Sourdough Manager** embeds:
   - **Pickup Scheduler** - Toggle ON
   - **Subscribe & Save** - Toggle OFF (we're using Shopify's native UI for now)
4. Click **Save**

---

### Phase 2: Test Pickup Scheduler (Cart Page)

**Purpose:** Verify the pickup date/time selection works on the cart page.

#### Test 2.1: Basic Pickup Selection
1. Open TEST theme preview (click "Preview" on TEST theme)
2. Navigate to the TEST product (use direct URL)
3. Select a subscription option and click "Add to cart"
4. Go to cart page
5. **Expected:** Pickup scheduler widget should appear
6. **Verify:**
   - [ ] Available pickup days show correctly
   - [ ] Time slots display for selected day
   - [ ] Blackout dates are blocked
   - [ ] Selection persists on page refresh

#### Test 2.2: Pickup Validation
1. Try to proceed to checkout WITHOUT selecting pickup date/time
2. **Expected:** Error message preventing checkout
3. Select a valid pickup date and time
4. Proceed to checkout
5. **Expected:** Checkout should proceed normally

#### Test 2.3: Pickup Data in Order
1. Complete a test checkout (use Shopify's test payment gateway)
2. Check the order in Shopify Admin → Orders
3. **Expected:** Order notes/attributes should include:
   - Pickup date
   - Pickup time slot
   - Any other pickup metadata

---

### Phase 3: Test Subscription Webhook Integration

**Purpose:** Verify the app receives and processes subscription contracts from Shopify.

#### Test 3.1: Subscription Creation Webhook
1. Complete a subscription purchase on TEST theme with TEST product
2. Check **Shopify Admin → Apps → Subscriptions → Contracts**
3. **Expected:** New subscription contract appears
4. Check **Susies Sourdough Manager App → Subscriptions**
5. **Expected:** Subscription should appear in app (via webhook)

#### Test 3.2: Check Webhook Logs
1. Check Railway logs for the app
2. Search for `subscription_contracts/create` webhook
3. **Expected:** Webhook received and processed successfully
4. **Verify database:** Subscription record created in `SubscriptionPickup` table

#### Test 3.3: Manual Sync (Fallback)
If webhook didn't work:
1. Go to **Susies Sourdough Manager → Settings → Subscriptions**
2. Use **Manual Sync** feature with the contract ID or order number
3. **Expected:** Subscription syncs to the app

---

### Phase 4: Test Customer Portal

**Purpose:** Verify customers can manage their subscriptions.

#### Test 4.1: Access Customer Portal
1. Log in as the test customer (or use customer impersonation)
2. Navigate to: `https://susiessourdough.com/apps/my-subscription`
3. **Expected:** Customer portal loads showing subscription(s)

#### Test 4.2: Pause Subscription
1. Click "Pause" on a subscription
2. Select a resume date (or indefinite)
3. Confirm
4. **Expected:**
   - Subscription status changes to PAUSED
   - Pause reflected in Shopify Admin
   - Pause reflected in app admin

#### Test 4.3: Resume Subscription
1. Click "Resume" on a paused subscription
2. **Expected:** Status changes back to ACTIVE

#### Test 4.4: One-Time Reschedule
1. Click "Reschedule Next Pickup"
2. Select a different date/time
3. **Expected:** Next pickup rescheduled, future pickups unchanged

#### Test 4.5: Permanent Schedule Change
1. Click "Change Pickup Schedule"
2. Select new preferred day and time slot
3. **Expected:** All future pickups use new schedule

#### Test 4.6: Cancel Subscription
1. Click "Cancel Subscription"
2. Optionally provide reason
3. Confirm
4. **Expected:**
   - Subscription cancelled
   - Reflected in Shopify Admin
   - No future billings scheduled

---

### Phase 5: Test Admin Features

**Purpose:** Verify admin can manage subscriptions from the app.

#### Test 5.1: Subscription List
1. Go to **Susies Sourdough Manager → Subscriptions**
2. **Verify:**
   - [ ] List shows all subscriptions
   - [ ] Status filter works (Active/Paused/Cancelled)
   - [ ] Search works
   - [ ] CSV export works

#### Test 5.2: Subscription Detail
1. Click on a subscription
2. **Verify:**
   - [ ] Customer info displays correctly
   - [ ] Product/variant info correct
   - [ ] Pricing and discounts correct
   - [ ] Payment method info shows
   - [ ] Next billing/pickup dates correct

#### Test 5.3: Admin Actions
1. Test Pause/Resume from admin
2. Test Reschedule from admin
3. Test billing retry (if applicable)
4. **Expected:** All actions work and sync with Shopify

---

### Phase 6: Test Billing System

**Purpose:** Verify the billing lead time and billing attempts work.

#### Test 6.1: Billing Date Calculation
1. Check a subscription's next pickup date
2. Verify billing date is correctly calculated (default: 84 hours before)
3. **Formula:** `billing_date = pickup_date - billing_lead_hours`

#### Test 6.2: Billing Lead Time Configuration
1. Go to subscription settings in app
2. Modify billing lead hours (1-168 hours)
3. **Expected:** Future billing dates recalculated

---

### Phase 7: Production Rollout Plan

**DO NOT EXECUTE UNTIL ALL TESTS PASS**

#### Step 7.1: Migrate Existing Subscriptions
1. Export existing subscriptions from Shopify Subscriptions
2. Use Manual Sync to import each contract into Susies Sourdough Manager
3. Verify all subscriptions appear in app with correct data

#### Step 7.2: Enable App on Live Theme
1. Go to **Dawn (live) → Customize → App embeds**
2. Enable **Pickup Scheduler**
3. Keep **Subscribe & Save** OFF (use Shopify native UI)
4. Save

#### Step 7.3: Monitor
1. Watch for errors in Railway logs
2. Monitor webhook deliveries in Shopify Admin
3. Test a real subscription purchase
4. Verify customer portal works

---

### Troubleshooting

**Webhook not received:**
- Check Shopify Admin → Settings → Notifications → Webhooks
- Verify webhook URLs are correct in `shopify.app.susies-sourdough-manager.toml`
- Check Railway logs for errors

**Pickup scheduler not showing:**
- Verify app embed is enabled in theme
- Check browser console for JavaScript errors
- Verify the app proxy is configured correctly

**Customer portal not loading:**
- Check app proxy configuration in TOML
- Verify customer is logged in
- Check for CORS or authentication errors

---

### Files Reference

| Component | Files |
|-----------|-------|
| Pickup Scheduler (Cart) | `extensions/pickup-scheduler-cart/assets/pickup-scheduler.js`, `blocks/pickup-scheduler.liquid` |
| Subscribe & Save Widget | `extensions/pickup-scheduler-cart/assets/subscribe-save.js`, `blocks/subscribe-save.liquid` |
| Customer Portal | `app/routes/apps.my-subscription.tsx` |
| Subscription Webhooks | `app/routes/webhooks.subscription_contracts.*.tsx` |
| Admin Dashboard | `app/routes/app.subscriptions.*.tsx` |
| Billing Service | `app/services/subscription-billing.server.ts` |

---

### 2026-02-08 - Code Audit & Security Improvements
**Context:**
Comprehensive code audit identified multiple areas for improvement including input validation, error handling, pagination, and environment configuration.

**Improvements Made:**

1. **Input Validation (prep-times route)**
   - Added `parseLeadTime()` helper with min/max bounds (1-7 days)
   - Added `isValidTimeFormat()` regex validation for HH:MM format
   - Wrapped action handler in try-catch with proper error responses

2. **Orders Page Pagination & Error Handling**
   - Added cursor-based pagination with `ITEMS_PER_PAGE = 50`
   - Added status filter validation against allowed values array
   - Added search input length limit (100 chars) to prevent abuse
   - Optimized N+1 query by selecting only needed fields from subscriptionPickup
   - Added error banner display in UI
   - Added "Load More" button for pagination

3. **Environment Variable Validation**
   - Created `app/utils/env.server.ts` utility
   - Validates required vars at startup (SHOPIFY_API_KEY, SHOPIFY_API_SECRET, etc.)
   - Warns about partially configured integrations (Twilio, SendGrid, Google)
   - Provides `getRequiredEnv()` and `isIntegrationConfigured()` helpers
   - Logs validation results to console at startup

**Files Modified:**
- `app/routes/app.settings.prep-times.tsx` - Input validation and error handling
- `app/routes/app.orders._index.tsx` - Pagination, validation, error handling, UI updates
- `app/shopify.server.ts` - Added env validation call at startup

**Files Created:**
- `app/utils/env.server.ts` - Environment variable validation utility

4. **Google Calendar Retry Logic**
   - Added `withRetry()` helper with exponential backoff (1s, 2s, 4s)
   - Retries up to 3 times for transient failures
   - Skips retry on 4xx client errors (except 429 rate limit)
   - Applied to create, update, and delete calendar operations

**Files Modified (additional):**
- `app/services/google-calendar.server.ts` - Added retry logic with exponential backoff

**Notes:**
- Webhook idempotency already implemented via WebhookEvent table ✓
- Rate limiting is in-memory (suitable for single-instance, consider Redis for multi-instance)

---

### 2026-02-01 - COD Payment Issue Resolution
**Problem:**
- Test subscription order (#1784) placed with Cash on Delivery (COD) payment didn't create a subscription contract
- COD is incompatible with subscriptions because Shopify requires payment methods that can be charged automatically for recurring billing
- When COD is used for a subscription order, Shopify creates a regular one-time order instead of a subscription contract

**Investigation:**
- Initially attempted to create a Shopify Function to hide COD at checkout for subscription orders
- Created `hide-cod-subscriptions` payment customization function extension
- Discovered that payment customization functions require **Shopify Plus** ($399/month) for custom apps
- Basic plan ($39/month) cannot use payment customization functions from custom apps

**Resolution:**
- Disabled COD entirely in Shopify Settings → Payments → Manual payment methods
- This ensures all subscription orders use card payments that support automatic recurring billing
- Removed the unused function extension and admin page code

**Files Removed:**
- `extensions/hide-cod-subscriptions/` - Payment customization function (requires Plus plan)
- `app/routes/app.settings.payment-customizations.tsx` - Admin page for managing the function

**Files Modified:**
- `app/routes/app.settings._index.tsx` - Removed Payment Customizations settings link
- `shopify.app.susies-sourdough-manager.toml` - Removed payment_customizations API scopes

**Key Learning:**
Shopify Functions for payment customizations are only available to Shopify Plus merchants when using custom apps. For Basic plan stores, use Shopify's built-in payment settings to disable incompatible payment methods.

---

### 2026-01-31 - Fix maxBookingDays to Use Calendar Days
**Changes:**
- Changed pickup availability API to limit by calendar days instead of number of available pickup dates
- Previously: `maxBookingDays: 14` meant 14 available pickup dates (~3.5 weeks with 4 pickup days/week)
- Now: `maxBookingDays: 14` means dates within the next 14 calendar days (~7 pickup dates)

**Files Modified:**
- `app/routes/apps.pickup-availability.tsx` - changed loop logic to use calendar days

**App Versions Released:** susies-sourdough-manager-18

---

### 2026-01-31 - Theme Cart.js Compatibility Fix
**Changes:**
- Fixed theme cart.js conflict causing "increments of undefined" error
- Wrapped hidden inputs in fieldset with `data-pickup-scheduler` attributes to prevent theme JS from processing them as cart item inputs
- Added `data-cart-item="false"` attribute to scheduler container for theme compatibility

**Root Cause:** Theme's `CartItems.resetQuantityInput` was iterating over all form inputs and failing when encountering our hidden pickup scheduler inputs.

**Files Modified:**
- `extensions/pickup-scheduler-cart/assets/pickup-scheduler.js` - wrapped inputs in fieldset, added data attributes

**App Versions Released:** susies-sourdough-manager-15

---

### 2026-01-31 - Pickup Scheduler Cart Validation & Documentation
**Changes:**
- Added checkout validation requiring date AND time slot selection before proceeding
- Calendar now auto-advances to first available date's month
- Fixed app proxy routing (`apps.pickup-availability.tsx` handles pickup API)
- Added CSS fixes for full-width layout in various themes
- Created this CLAUDE.md documentation file

**Files Modified:**
- `extensions/pickup-scheduler-cart/assets/pickup-scheduler.js` - validation logic, calendar month fix
- `extensions/pickup-scheduler-cart/assets/pickup-scheduler.css` - full-width container styles
- `app/routes/apps.pickup-availability.tsx` - NEW: pickup availability API endpoint
- `CLAUDE.md` - NEW: project documentation

**App Versions Released:** susies-sourdough-manager-6 through susies-sourdough-manager-9

---

### 2026-01-31 - Selling Plan Groups Fix
**Changes:**
- Fixed selling plan groups display loop by falling back to local database config
- Added SellingPlan model to store additional plans beyond weekly/biweekly
- Fixed duplicate options error by including discount in option label

**Files Modified:**
- `app/routes/app.settings.subscriptions.tsx` - fallback logic
- `app/services/selling-plans.server.ts` - local plan storage
- `prisma/schema.prisma` - SellingPlan model

---

### Initial Release
**Features:**
- Subscription management with weekly/bi-weekly plans
- Customer self-service portal at `/apps/my-subscription`
- Pickup scheduling on cart page
- Admin configuration for pickup days, time slots, blackouts
- Order management dashboard
