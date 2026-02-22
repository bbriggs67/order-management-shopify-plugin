-- Audit hardening: CHECK constraints, indexes for CRM queries, onDelete rules, updatedAt on BillingAttemptLog

-- ============================================
-- CHECK CONSTRAINTS (business rule enforcement at DB level)
-- ============================================

-- Discount percent must be 0-100
ALTER TABLE "SubscriptionPickup"
  ADD CONSTRAINT chk_subscription_discount_range
  CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);

ALTER TABLE "SubscriptionPlanFrequency"
  ADD CONSTRAINT chk_plan_freq_discount_range
  CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);

-- Preferred day must be 0-6 (Sun-Sat)
ALTER TABLE "SubscriptionPickup"
  ADD CONSTRAINT chk_preferred_day_range
  CHECK ("preferredDay" >= 0 AND "preferredDay" <= 6);

-- Pickup day config day must be 0-6
ALTER TABLE "PickupDayConfig"
  ADD CONSTRAINT chk_day_of_week_range
  CHECK ("dayOfWeek" >= 0 AND "dayOfWeek" <= 6);

-- Billing lead hours must be 1-168 (1 hour to 1 week)
ALTER TABLE "SubscriptionPickup"
  ADD CONSTRAINT chk_billing_lead_hours_range
  CHECK ("billingLeadHours" >= 1 AND "billingLeadHours" <= 168);

-- Quantities must be positive
ALTER TABLE "OrderItem"
  ADD CONSTRAINT chk_order_item_quantity_positive
  CHECK ("quantity" > 0);

ALTER TABLE "ExtraBakeOrder"
  ADD CONSTRAINT chk_extra_bake_quantity_positive
  CHECK ("quantity" > 0);

-- ============================================
-- INDEXES for CRM customer email lookups
-- ============================================

CREATE INDEX IF NOT EXISTS "PickupSchedule_shop_customerEmail_idx"
  ON "PickupSchedule" ("shop", "customerEmail");

CREATE INDEX IF NOT EXISTS "SubscriptionPickup_shop_customerEmail_idx"
  ON "SubscriptionPickup" ("shop", "customerEmail");

-- ============================================
-- BillingAttemptLog: add updatedAt for audit trail
-- ============================================

ALTER TABLE "BillingAttemptLog"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
