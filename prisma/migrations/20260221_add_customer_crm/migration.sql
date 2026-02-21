-- CRM: Customer model (local cache of Shopify customer data)
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "totalOrderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CRM: CustomerNote model (admin notes per customer)
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "syncedToShopify" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- Indexes for Customer
CREATE UNIQUE INDEX "Customer_shop_shopifyCustomerId_key" ON "Customer"("shop", "shopifyCustomerId");
CREATE UNIQUE INDEX "Customer_shop_email_key" ON "Customer"("shop", "email");
CREATE INDEX "Customer_shop_idx" ON "Customer"("shop");
CREATE INDEX "Customer_shop_lastName_idx" ON "Customer"("shop", "lastName");

-- Indexes for CustomerNote
CREATE INDEX "CustomerNote_customerId_idx" ON "CustomerNote"("customerId");
CREATE INDEX "CustomerNote_shop_idx" ON "CustomerNote"("shop");

-- Foreign key for CustomerNote -> Customer
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
