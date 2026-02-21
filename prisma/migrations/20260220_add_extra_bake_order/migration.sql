-- CreateTable
CREATE TABLE "ExtraBakeOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "timeSlot" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtraBakeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtraBakeOrder_shop_idx" ON "ExtraBakeOrder"("shop");

-- CreateIndex
CREATE INDEX "ExtraBakeOrder_shop_date_idx" ON "ExtraBakeOrder"("shop", "date");
