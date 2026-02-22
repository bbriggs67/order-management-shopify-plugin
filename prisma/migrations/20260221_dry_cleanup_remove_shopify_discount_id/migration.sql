-- DRY cleanup: remove shopifyDiscountId from SubscriptionPlanFrequency
-- The discount code sync system has been removed in favor of the automatic Discount Function

ALTER TABLE "SubscriptionPlanFrequency" DROP COLUMN IF EXISTS "shopifyDiscountId";
