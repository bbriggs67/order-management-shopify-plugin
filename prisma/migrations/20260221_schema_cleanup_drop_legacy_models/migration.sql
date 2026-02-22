-- Schema cleanup: drop legacy models, strip WebhookEvent payload, remove cached Customer fields

-- Drop legacy SellingPlan table (superseded by SSMA v2 SubscriptionPlanFrequency)
DROP TABLE IF EXISTS "SellingPlan";

-- Drop legacy SellingPlanConfig table (superseded by SSMA v2 SubscriptionPlanGroup)
DROP TABLE IF EXISTS "SellingPlanConfig";

-- Make WebhookEvent.payload optional (existing rows keep their data; new rows store {})
ALTER TABLE "WebhookEvent" ALTER COLUMN "payload" DROP NOT NULL;

-- Remove cached Customer fields (now fetched live from Shopify API)
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "totalOrderCount";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "totalSpent";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "tags";
