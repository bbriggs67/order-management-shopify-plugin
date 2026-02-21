-- CreateTable
CREATE TABLE "SellingPlan" (
    "id" TEXT NOT NULL,
    "shopifyPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "configId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellingPlan_configId_shopifyPlanId_key" ON "SellingPlan"("configId", "shopifyPlanId");

-- AddForeignKey
ALTER TABLE "SellingPlan" ADD CONSTRAINT "SellingPlan_configId_fkey" FOREIGN KEY ("configId") REFERENCES "SellingPlanConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
