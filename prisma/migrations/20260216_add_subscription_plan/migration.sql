-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "discountPercent" DOUBLE PRECISION NOT NULL,
    "discountCode" TEXT,
    "billingLeadHours" INTEGER NOT NULL DEFAULT 48,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_shop_interval_intervalCount_key" ON "SubscriptionPlan"("shop", "interval", "intervalCount");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_shop_idx" ON "SubscriptionPlan"("shop");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_shop_isActive_idx" ON "SubscriptionPlan"("shop", "isActive");
