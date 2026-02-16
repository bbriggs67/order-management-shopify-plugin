-- CreateTable: SubscriptionPlanGroup
CREATE TABLE "SubscriptionPlanGroup" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billingLeadHours" INTEGER NOT NULL DEFAULT 48,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlanGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SubscriptionPlanFrequency
CREATE TABLE "SubscriptionPlanFrequency" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "discountPercent" DOUBLE PRECISION NOT NULL,
    "discountCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlanFrequency_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SubscriptionPlanProduct
CREATE TABLE "SubscriptionPlanProduct" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlanProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionPlanGroup_shop_idx" ON "SubscriptionPlanGroup"("shop");

-- CreateIndex
CREATE INDEX "SubscriptionPlanGroup_shop_isActive_idx" ON "SubscriptionPlanGroup"("shop", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlanFrequency_groupId_interval_intervalCount_key" ON "SubscriptionPlanFrequency"("groupId", "interval", "intervalCount");

-- CreateIndex
CREATE INDEX "SubscriptionPlanFrequency_groupId_idx" ON "SubscriptionPlanFrequency"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlanProduct_groupId_shopifyProductId_key" ON "SubscriptionPlanProduct"("groupId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "SubscriptionPlanProduct_groupId_idx" ON "SubscriptionPlanProduct"("groupId");

-- AddForeignKey
ALTER TABLE "SubscriptionPlanFrequency" ADD CONSTRAINT "SubscriptionPlanFrequency_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SubscriptionPlanGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanProduct" ADD CONSTRAINT "SubscriptionPlanProduct_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SubscriptionPlanGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropTable: old flat SubscriptionPlan (data was only seed data, migrated via app code)
DROP TABLE "SubscriptionPlan";
