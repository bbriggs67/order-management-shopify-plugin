# Susie's Sourdough App - Production Transition Plan

## Overview
This plan covers transitioning the Susie's Sourdough Shopify app from the development store (`susies-sourdough-dev-3.myshopify.com`) to the commercial production store (`susiessourdough.com`) with 17 existing subscribers to migrate.

---

## Phase 1: Pre-Transition Setup

### 1.1 Create Production App in Shopify Partners
**Estimated time: 30 minutes**

1. Go to [Shopify Partners Dashboard](https://partners.shopify.com)
2. Create a new app:
   - Name: "Susie Sourdough Production"
   - App type: Custom app (private, single store)
   - This keeps the app private and not listed on the Shopify App Store
3. Note the new credentials:
   - `SHOPIFY_API_KEY` (Client ID)
   - `SHOPIFY_API_SECRET` (Client Secret)
4. Configure required access scopes:
   ```
   read_orders,write_orders,read_products,write_products,read_customers,
   read_own_subscription_contracts,write_own_subscription_contracts,
   read_customer_payment_methods
   ```

### 1.2 Create Production Database on Railway
**Estimated time: 15 minutes**

1. Log into [Railway](https://railway.app)
2. Create a new PostgreSQL database for production
   - Name it: `susie-sourdough-production`
   - Note the `DATABASE_URL` connection string
3. Keep the existing dev database separate for continued development

### 1.3 Create Production shopify.app.toml
**Action required: Create new config file**

```bash
# In the app directory, create production config:
cp shopify.app.toml shopify.app.susies-sourdough-prod.toml
```

Update the production config with:
- New `client_id` from production app
- Production `application_url` (Railway URL)
- Production store domain

---

## Phase 2: Railway Production Deployment

### 2.1 Railway Project Setup
**Estimated time: 1-2 hours**

1. **Create Railway Project**
   - Go to Railway Dashboard → New Project
   - Connect to your GitHub repository
   - Select the branch for production (e.g., `main`)

2. **Configure Environment Variables**
   ```
   # Shopify (from Partners Dashboard - production app)
   SHOPIFY_API_KEY=<production_api_key>
   SHOPIFY_API_SECRET=<production_api_secret>
   SHOPIFY_APP_URL=https://<your-railway-app>.railway.app
   SCOPES=read_orders,write_orders,read_products,write_products,read_customers,read_own_subscription_contracts,write_own_subscription_contracts,read_customer_payment_methods

   # Database (production)
   DATABASE_URL=<railway_production_postgres_url>

   # Google Calendar (copy from dev)
   GOOGLE_CLIENT_ID=<your_google_client_id>
   GOOGLE_CLIENT_SECRET=<your_google_client_secret>
   GOOGLE_REDIRECT_URI=https://<your-railway-app>.railway.app/api/google/callback

   # App Settings
   SESSION_SECRET=<generate_new_secure_secret>
   NODE_ENV=production

   # Cron Protection
   CRON_SECRET=<generate_new_secure_secret>
   ```

3. **Update Dockerfile** (if needed)
   - Current Dockerfile uses Node 18 - consider updating to Node 20 for consistency:
   ```dockerfile
   FROM node:20-alpine
   ```

4. **Configure Health Checks**
   - Add `/health` endpoint to app for Railway health monitoring
   - Configure Railway to restart container on failure

### 2.2 24/7 Reliability Configuration
**Critical for production**

1. **Railway Plan Requirements**
   - Ensure you're on a paid plan for 24/7 uptime (Hobby plan minimum)
   - Free tier has limitations that can cause downtime

2. **Configure Auto-restart**
   - Railway Settings → Enable automatic restarts
   - Configure health check endpoint

3. **Add Health Check Endpoint** (if not exists)
   Create file: `app/routes/health.tsx`
   ```typescript
   export const loader = () => {
     return new Response("OK", { status: 200 });
   };
   ```

4. **Database Connection Pooling**
   - Railway Postgres includes connection pooling
   - Verify `DATABASE_URL` uses pooled connection string for production

5. **Monitoring Setup**
   - Enable Railway metrics
   - Consider adding external uptime monitoring (UptimeRobot, Better Uptime)

---

## Phase 3: Theme Extension Setup

### 3.1 Deploy Extensions to Production App
**Estimated time: 30 minutes**

```bash
# Switch to production config
shopify app config use shopify.app.susies-sourdough-prod.toml

# Deploy extensions
shopify app deploy
```

This deploys:
- `pickup-scheduler-cart` extension (includes Subscribe & Save widget)

### 3.2 Install App on Production Store
**Estimated time: 15 minutes**

1. From Partners Dashboard, get the install link for production app
2. Install on `susiessourdough.myshopify.com`
3. Approve all requested permissions

### 3.3 Configure Theme (TEST - DO NOT PUBLISH)
**Estimated time: 30-60 minutes**

1. **Duplicate Current Live Theme**
   - Go to Online Store → Themes
   - Click "..." on live theme → Duplicate
   - Rename to "TEST - Susie Sourdough with App"

2. **Enable App Embed**
   - Open TEST theme in editor
   - Go to Theme Settings → App Embeds
   - Enable "Subscribe & Save" app embed

3. **Add App Blocks to Pages**
   - Product page: Add Subscribe & Save widget
   - Cart page: Add Pickup Scheduler block
   - Configure positioning and styling

4. **Test Thoroughly Before Publishing**
   - Preview theme with test orders
   - Verify pickup scheduler works
   - Verify Subscribe & Save displays correctly
   - Test checkout flow

---

## Phase 4: Migrate Existing Subscribers (17 customers)

### 4.1 Export Current Subscriber Data
**Estimated time: 1-2 hours**

Document for each subscriber:
```
- Customer name
- Email
- Phone
- Current subscription products
- Subscription frequency (weekly/bi-weekly)
- Preferred pickup day
- Preferred time slot
- Payment method ID (if using Shopify Payments)
- Current billing cycle date
- Any special notes
```

### 4.2 Create Selling Plan Group in Production
**Estimated time: 15 minutes**

1. Open production app admin
2. Go to Settings → Subscriptions
3. Click "Create Selling Plans"
4. This creates:
   - Weekly plan (10% off)
   - Bi-weekly plan (5% off)

### 4.3 Add Products to Selling Plan
**Estimated time: 15 minutes**

1. In app admin, go to Subscription Products
2. Add all subscription-eligible products to the selling plan group

### 4.4 Migrate Subscription Contracts
**Estimated time: 2-4 hours for 17 subscribers**

**Option A: Manual Migration via Admin UI**
For each subscriber:
1. Create subscription contract in Shopify admin
2. Create corresponding `SubscriptionPickup` record in app database
3. Set up billing schedule

**Option B: Programmatic Migration (Recommended)**
Create migration script: `scripts/migrate-subscribers.ts`

```typescript
// Migration approach using Shopify GraphQL API
// subscriptionContractAtomicCreate mutation

const subscribers = [
  {
    customerId: "gid://shopify/Customer/123",
    email: "customer@email.com",
    // ... other fields
  },
  // ... 16 more subscribers
];

for (const sub of subscribers) {
  // 1. Create subscription contract in Shopify
  // 2. Create SubscriptionPickup in our database
  // 3. Create initial PickupSchedule
  // 4. Sync to Google Calendar
}
```

### 4.5 Payment Method Migration
**Critical consideration**

If subscribers have existing payment methods with another provider:
- Use `CustomerPaymentMethodRemoteCreate` mutation to associate Stripe cards
- Pause billing during migration to avoid double-charging
- Verify payment methods are valid before resuming

### 4.6 Communicate with Subscribers
**Recommended: Send email notification**

```
Subject: Important Update to Your Susie's Sourdough Subscription

Dear [Name],

We've upgraded our subscription system to serve you better!

Your subscription details remain the same:
- Products: [list]
- Frequency: [weekly/bi-weekly]
- Pickup day: [day]
- Time slot: [time]

New features available:
- View and manage your subscription at susiessourdough.com/apps/my-subscription
- One-time pickup rescheduling
- Updated pickup reminders

No action needed on your part. Your next pickup is scheduled for [date].

Questions? Reply to this email or call [phone].

Thank you for being a valued subscriber!
- Susie
```

---

## Phase 5: Testing Checklist

### 5.1 Pre-Launch Testing (on TEST theme)
**Estimated time: 2-4 hours**

- [ ] **Storefront Tests**
  - [ ] Subscribe & Save widget displays on product pages
  - [ ] Pickup scheduler displays in cart
  - [ ] Pickup time slots load correctly
  - [ ] Blackout dates are respected
  - [ ] Can complete checkout with subscription
  - [ ] Can complete checkout with one-time purchase + pickup

- [ ] **Admin Tests**
  - [ ] App loads in Shopify admin
  - [ ] Can view/manage subscriptions
  - [ ] Can reschedule pickups (one-time and permanent)
  - [ ] Can pause/cancel subscriptions
  - [ ] Pickup availability settings work
  - [ ] Time slot configuration works

- [ ] **Customer Portal Tests**
  - [ ] `/apps/my-subscription` loads for logged-in customers
  - [ ] Can view subscription details
  - [ ] Can request one-time reschedule
  - [ ] Can request permanent reschedule

- [ ] **Webhook Tests**
  - [ ] Order create webhook fires
  - [ ] Subscription billing success webhook fires
  - [ ] Subscription billing failure webhook fires

- [ ] **Google Calendar Integration**
  - [ ] New pickups create calendar events
  - [ ] Rescheduled pickups update calendar events
  - [ ] Cancelled pickups remove calendar events

- [ ] **Billing Tests** (use Shopify test mode)
  - [ ] Subscription billing triggers correctly
  - [ ] 84-hour lead time is respected
  - [ ] Failed billing creates proper records

### 5.2 Load Testing
- [ ] Simulate multiple concurrent users
- [ ] Verify Railway handles expected traffic

---

## Phase 6: Go-Live Checklist

### 6.1 Final Pre-Launch Steps
- [ ] All tests pass on TEST theme
- [ ] All 17 subscribers migrated and verified
- [ ] Google Calendar integration connected
- [ ] Cron job configured for subscription billing
- [ ] Monitoring/alerting set up
- [ ] Backup strategy in place

### 6.2 Launch Steps
1. **Schedule low-traffic time** (e.g., late evening)
2. **Publish TEST theme** (make it live)
3. **Monitor closely** for first 24-48 hours
4. **Verify first subscription billings** process correctly

### 6.3 Post-Launch Monitoring
- [ ] Check Railway logs for errors
- [ ] Monitor billing attempt success rate
- [ ] Verify calendar events are created
- [ ] Check customer portal accessibility
- [ ] Monitor database performance

---

## Phase 7: Ongoing Operations

### 7.1 Regular Maintenance
- Database backups (Railway automatic)
- Log rotation
- Dependency updates (monthly)
- Security patches

### 7.2 Monitoring Checklist
- Uptime monitoring (set up alerts)
- Error rate tracking
- Billing success rate
- Database size/performance

### 7.3 Cron Job Requirements
Set up external cron service to call:
```
POST https://<your-app>.railway.app/api/cron/process-subscriptions
Header: Authorization: Bearer <CRON_SECRET>
```

Options:
- [Cron-job.org](https://cron-job.org) (free)
- [EasyCron](https://www.easycron.com)
- Railway Cron (if available)

---

## Important Notes & Warnings

### Private App Considerations
- Custom/private apps are NOT listed on Shopify App Store
- Only accessible to stores you explicitly install it on
- Perfect for single-store use like Susie's Sourdough

### Shopify API Changes (2025-2026)
- As of April 2025, new public apps must use GraphQL (already compliant)
- Starting January 2026, new custom apps must be created via Dev Dashboard (not admin)
- Your existing app will continue to work

### Billing Safety
- **PAUSE billing in current system** before migration
- Avoid double-charging subscribers
- Verify payment methods before resuming

### Rollback Plan
If critical issues occur:
1. Revert theme to previous version
2. Pause subscription billing
3. Investigate and fix issues
4. Re-test before trying again

---

## Resource Links

- [Shopify Custom Apps Documentation](https://help.shopify.com/en/manual/apps/app-types/custom-apps)
- [Shopify App Deployment Guide](https://shopify.dev/docs/apps/launch/deployment)
- [Railway Deployment Docs](https://docs.railway.com/guides/deployments)
- [Subscription Contract Migration](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/migrate-to-subscriptions-api/migrate-subscription-contracts)
- [Payment Method Migration](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/migrate-to-subscriptions-api/migrate-customer-information)

---

## Estimated Timeline

| Phase | Task | Duration |
|-------|------|----------|
| 1 | Pre-Transition Setup | 1-2 hours |
| 2 | Railway Deployment | 2-4 hours |
| 3 | Theme Extension Setup | 1-2 hours |
| 4 | Subscriber Migration | 4-6 hours |
| 5 | Testing | 4-8 hours |
| 6 | Go-Live | 1-2 hours |
| **Total** | | **13-24 hours** |

Recommend spreading over 1-2 weeks to allow thorough testing between phases.
