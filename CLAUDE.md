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

### 2026-02-01 - Hide COD for Subscriptions Function
**Changes:**
- Created new Shopify Function to hide Cash on Delivery (COD) payment option when cart contains subscription items
- COD is incompatible with subscriptions because it cannot be charged automatically for recurring billing
- Function checks cart lines for `sellingPlanAllocation` and hides any payment method containing "cash on delivery", "cod", "pay on delivery", or "collect on delivery" in the name

**Files Added:**
- `extensions/hide-cod-subscriptions/` - New payment customization function extension
  - `src/cart_payment_methods_transform_run.js` - Function logic
  - `src/cart_payment_methods_transform_run.graphql` - Input query for cart and payment methods
  - `shopify.extension.toml` - Extension configuration
  - `locales/en.default.json` - Localized strings

**Activation Required:**
After deployment, the function must be activated in Shopify Admin:
1. Go to Settings > Payments
2. Click "Manage" on the payment provider
3. Enable the "Hide COD for Subscriptions" customization

**App Versions Released:** susies-sourdough-manager-19

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
