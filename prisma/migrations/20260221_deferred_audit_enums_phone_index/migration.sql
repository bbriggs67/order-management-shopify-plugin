-- Deferred audit items: enums for frequency/billing status, phoneNormalized for SMS lookup

-- ============================================
-- 1. Create SubscriptionFrequency enum and convert frequency column
-- ============================================

CREATE TYPE "SubscriptionFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'TRIWEEKLY');

-- Convert existing frequency String column to enum
-- First verify all existing values are valid, then alter
ALTER TABLE "SubscriptionPickup"
  ALTER COLUMN "frequency" TYPE "SubscriptionFrequency"
  USING "frequency"::"SubscriptionFrequency";

-- ============================================
-- 2. Create BillingAttemptStatus enum and convert status columns
-- ============================================

CREATE TYPE "BillingAttemptStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- Convert BillingAttemptLog.status
ALTER TABLE "BillingAttemptLog"
  ALTER COLUMN "status" TYPE "BillingAttemptStatus"
  USING "status"::"BillingAttemptStatus";

-- Set default
ALTER TABLE "BillingAttemptLog"
  ALTER COLUMN "status" SET DEFAULT 'PENDING'::"BillingAttemptStatus";

-- Convert SubscriptionPickup.lastBillingStatus (nullable)
ALTER TABLE "SubscriptionPickup"
  ALTER COLUMN "lastBillingStatus" TYPE "BillingAttemptStatus"
  USING "lastBillingStatus"::"BillingAttemptStatus";

-- ============================================
-- 3. Add phoneNormalized to Customer for indexed SMS lookup
-- ============================================

ALTER TABLE "Customer" ADD COLUMN "phoneNormalized" TEXT;

-- Backfill: normalize existing phone numbers to E.164
-- Handles: 10-digit US → +1XXXXXXXXXX, 11-digit starting with 1 → +1XXXXXXXXXX
UPDATE "Customer"
SET "phoneNormalized" = CASE
  WHEN "phone" IS NULL THEN NULL
  WHEN "phone" LIKE '+%' THEN regexp_replace("phone", '[^0-9+]', '', 'g')
  WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) = 10
    THEN '+1' || regexp_replace("phone", '[^0-9]', '', 'g')
  WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) = 11
    AND regexp_replace("phone", '[^0-9]', '', 'g') LIKE '1%'
    THEN '+' || regexp_replace("phone", '[^0-9]', '', 'g')
  ELSE '+' || regexp_replace("phone", '[^0-9]', '', 'g')
END
WHERE "phone" IS NOT NULL;

-- Create index for fast lookup
CREATE INDEX "Customer_phoneNormalized_idx" ON "Customer" ("phoneNormalized");
