-- AlterTable: Change discountPercent from INT to DOUBLE PRECISION (Float)
-- This allows storing 2.5% for triweekly subscriptions without truncation
ALTER TABLE "SubscriptionPickup" ALTER COLUMN "discountPercent" SET DATA TYPE DOUBLE PRECISION;
