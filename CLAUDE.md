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

**Status:** Under Investigation

**Symptom:** Two subscription/selling plan picker widgets appear on product pages in the TEST theme.

**Investigation Plan:**

1. **Check Shopify Admin - Selling Plan Groups**
   - Go to Apps → Susies Sourdough Manager → Subscription Settings
   - Check if multiple selling plan groups exist
   - Check which products are associated with each group
   - Look for duplicate associations

2. **Check Product Configuration**
   - Go to Products → [Product] → scroll to "Purchase options"
   - See if product is in multiple selling plan groups
   - Try removing product from ALL selling plan groups, save, then re-add to ONE group

3. **Check Theme Configuration**
   - In Theme Editor → Default product template
   - Look for duplicate "Variant picker" or subscription-related blocks
   - Check if there's a selling plan block AND our custom Subscribe & Save embed both active

4. **Check Theme Code Directly**
   - Look at theme's `main-product.liquid` or similar for duplicate selling plan renders
   - Search for `selling_plan_groups` in theme code
   - Check `settings_data.json` for duplicate embed entries

5. **Check for Residual App Code**
   - Sami B2B Lock was showing in console - check for leftover embeds
   - Bird Pickup Delivery DateTime Picker - ensure it's disabled
   - Look for any third-party subscription apps still active

6. **Research Shopify Forums**
   - Search: "duplicate selling plan picker Shopify"
   - Search: "subscription widget showing twice"
   - Search: "selling plan UI duplicate theme"
   - Check Shopify Community forums and GitHub issues

7. **Test with Fresh Theme**
   - Duplicate the Dawn theme (fresh copy)
   - Enable ONLY our app embeds
   - Test if duplicate still appears
   - This isolates whether it's theme-specific or product-specific

**Workaround (if needed):**
- Disable our custom Subscribe & Save widget in App embeds
- Use only Shopify's native selling plan UI
- This loses the "Porch Pick-up Only" custom messaging but prevents duplicates

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
