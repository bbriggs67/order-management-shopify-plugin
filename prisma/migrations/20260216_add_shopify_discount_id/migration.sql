-- Add shopifyDiscountId to SubscriptionPlanFrequency
-- Stores the Shopify discount code GID (auto-created by SSMA)
ALTER TABLE "SubscriptionPlanFrequency" ADD COLUMN "shopifyDiscountId" TEXT;
