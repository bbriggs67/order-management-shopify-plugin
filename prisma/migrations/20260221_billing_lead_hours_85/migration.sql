-- Update default billing lead hours from 48 to 85 (~3.5 days before pickup)

-- Update SubscriptionPlanGroup default
ALTER TABLE "SubscriptionPlanGroup" ALTER COLUMN "billingLeadHours" SET DEFAULT 85;

-- Update existing plan groups that still have the old default of 48
UPDATE "SubscriptionPlanGroup" SET "billingLeadHours" = 85 WHERE "billingLeadHours" = 48;

-- Update SubscriptionPickup default (was 84, now 85 for consistency)
ALTER TABLE "SubscriptionPickup" ALTER COLUMN "billingLeadHours" SET DEFAULT 85;

-- Update existing subscriptions that had the old defaults (48 or 84)
UPDATE "SubscriptionPickup" SET "billingLeadHours" = 85 WHERE "billingLeadHours" IN (48, 84);
