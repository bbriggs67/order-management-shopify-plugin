-- Full schema migration for Susie's Sourdough Shopify App
-- This creates all tables needed for the application

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('SCHEDULED', 'READY', 'PICKED_UP', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarAuth" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepTimeConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cutOffTime" TEXT NOT NULL DEFAULT '12:00',
    "leadTimeBefore" INTEGER NOT NULL DEFAULT 3,
    "leadTimeAfter" INTEGER NOT NULL DEFAULT 4,
    "maxBookingDays" INTEGER NOT NULL DEFAULT 14,
    "customByDay" BOOLEAN NOT NULL DEFAULT false,
    "mondayBefore" INTEGER,
    "mondayAfter" INTEGER,
    "tuesdayBefore" INTEGER,
    "tuesdayAfter" INTEGER,
    "wednesdayBefore" INTEGER,
    "wednesdayAfter" INTEGER,
    "thursdayBefore" INTEGER,
    "thursdayAfter" INTEGER,
    "fridayBefore" INTEGER,
    "fridayAfter" INTEGER,
    "saturdayBefore" INTEGER,
    "saturdayAfter" INTEGER,
    "sundayBefore" INTEGER,
    "sundayAfter" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepTimeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "availabilityMode" TEXT NOT NULL DEFAULT 'customize_by_day',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupDayConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxOrders" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupDayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeSlot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "maxOrders" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupLocation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackoutDate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "dateEnd" TIMESTAMP(3),
    "dayOfWeek" INTEGER,
    "startTime" TEXT,
    "endTime" TEXT,
    "reason" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlackoutDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupSchedule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "pickupDate" TIMESTAMP(3) NOT NULL,
    "pickupTimeSlot" TEXT NOT NULL,
    "pickupStatus" "PickupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "googleEventId" TEXT,
    "notes" TEXT,
    "pickupLocationId" TEXT,
    "subscriptionPickupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "pickupScheduleId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "quantity" INTEGER NOT NULL,
    "prepDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPickup" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyContractId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "preferredDay" INTEGER NOT NULL,
    "preferredTimeSlot" TEXT NOT NULL,
    "preferredTimeSlotStart" TEXT,
    "frequency" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "nextPickupDate" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "status" "SubStatus" NOT NULL DEFAULT 'ACTIVE',
    "pausedUntil" TIMESTAMP(3),
    "pauseReason" TEXT,
    "googleRecurEventId" TEXT,
    "billingLeadHours" INTEGER NOT NULL DEFAULT 84,
    "lastBillingAttemptId" TEXT,
    "lastBillingAttemptAt" TIMESTAMP(3),
    "lastBillingStatus" TEXT,
    "billingFailureCount" INTEGER NOT NULL DEFAULT 0,
    "billingFailureReason" TEXT,
    "billingCycleCount" INTEGER NOT NULL DEFAULT 0,
    "adminNotes" TEXT,
    "oneTimeRescheduleDate" TIMESTAMP(3),
    "oneTimeRescheduleTimeSlot" TEXT,
    "oneTimeRescheduleReason" TEXT,
    "oneTimeRescheduleBy" TEXT,
    "oneTimeRescheduleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPickup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAttemptLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "subscriptionPickupId" TEXT NOT NULL,
    "shopifyBillingId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "orderId" TEXT,
    "billingCycle" INTEGER NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "pickupScheduleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellingPlanConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sellingPlanGroupId" TEXT NOT NULL,
    "weeklySellingPlanId" TEXT,
    "biweeklySellingPlanId" TEXT,
    "weeklyDiscount" INTEGER NOT NULL DEFAULT 10,
    "biweeklyDiscount" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellingPlanConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsTemplate" TEXT NOT NULL DEFAULT 'Hi {name}! Your Susie''s Sourdough order #{number} is ready for pickup at {location}. Time slot: {time_slot}',
    "emailSubject" TEXT NOT NULL DEFAULT 'Your Susie''s Sourdough Order is Ready!',
    "emailTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarAuth_shop_key" ON "GoogleCalendarAuth"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "PrepTimeConfig_shop_key" ON "PrepTimeConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "PickupConfig_shop_key" ON "PickupConfig"("shop");

-- CreateIndex
CREATE INDEX "PickupDayConfig_shop_idx" ON "PickupDayConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "PickupDayConfig_shop_dayOfWeek_key" ON "PickupDayConfig"("shop", "dayOfWeek");

-- CreateIndex
CREATE INDEX "TimeSlot_shop_idx" ON "TimeSlot"("shop");

-- CreateIndex
CREATE INDEX "TimeSlot_shop_isActive_idx" ON "TimeSlot"("shop", "isActive");

-- CreateIndex
CREATE INDEX "TimeSlot_shop_dayOfWeek_idx" ON "TimeSlot"("shop", "dayOfWeek");

-- CreateIndex
CREATE INDEX "PickupLocation_shop_idx" ON "PickupLocation"("shop");

-- CreateIndex
CREATE INDEX "BlackoutDate_shop_idx" ON "BlackoutDate"("shop");

-- CreateIndex
CREATE INDEX "BlackoutDate_shop_date_idx" ON "BlackoutDate"("shop", "date");

-- CreateIndex
CREATE INDEX "BlackoutDate_shop_dayOfWeek_idx" ON "BlackoutDate"("shop", "dayOfWeek");

-- CreateIndex
CREATE INDEX "PickupSchedule_shop_idx" ON "PickupSchedule"("shop");

-- CreateIndex
CREATE INDEX "PickupSchedule_shop_pickupDate_idx" ON "PickupSchedule"("shop", "pickupDate");

-- CreateIndex
CREATE INDEX "PickupSchedule_shop_pickupStatus_idx" ON "PickupSchedule"("shop", "pickupStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PickupSchedule_shop_shopifyOrderId_key" ON "PickupSchedule"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_pickupScheduleId_idx" ON "OrderItem"("pickupScheduleId");

-- CreateIndex
CREATE INDEX "SubscriptionPickup_shop_idx" ON "SubscriptionPickup"("shop");

-- CreateIndex
CREATE INDEX "SubscriptionPickup_shop_status_idx" ON "SubscriptionPickup"("shop", "status");

-- CreateIndex
CREATE INDEX "SubscriptionPickup_shop_nextPickupDate_idx" ON "SubscriptionPickup"("shop", "nextPickupDate");

-- CreateIndex
CREATE INDEX "SubscriptionPickup_shop_nextBillingDate_idx" ON "SubscriptionPickup"("shop", "nextBillingDate");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPickup_shop_shopifyContractId_key" ON "SubscriptionPickup"("shop", "shopifyContractId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttemptLog_idempotencyKey_key" ON "BillingAttemptLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingAttemptLog_shop_idx" ON "BillingAttemptLog"("shop");

-- CreateIndex
CREATE INDEX "BillingAttemptLog_subscriptionPickupId_idx" ON "BillingAttemptLog"("subscriptionPickupId");

-- CreateIndex
CREATE INDEX "BillingAttemptLog_status_idx" ON "BillingAttemptLog"("status");

-- CreateIndex
CREATE INDEX "NotificationLog_shop_idx" ON "NotificationLog"("shop");

-- CreateIndex
CREATE INDEX "NotificationLog_pickupScheduleId_idx" ON "NotificationLog"("pickupScheduleId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shop_idx" ON "WebhookEvent"("shop");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_shop_topic_shopifyId_key" ON "WebhookEvent"("shop", "topic", "shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "SellingPlanConfig_shop_key" ON "SellingPlanConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_shop_key" ON "NotificationSettings"("shop");

-- AddForeignKey
ALTER TABLE "PickupSchedule" ADD CONSTRAINT "PickupSchedule_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "PickupLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupSchedule" ADD CONSTRAINT "PickupSchedule_subscriptionPickupId_fkey" FOREIGN KEY ("subscriptionPickupId") REFERENCES "SubscriptionPickup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_pickupScheduleId_fkey" FOREIGN KEY ("pickupScheduleId") REFERENCES "PickupSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAttemptLog" ADD CONSTRAINT "BillingAttemptLog_subscriptionPickupId_fkey" FOREIGN KEY ("subscriptionPickupId") REFERENCES "SubscriptionPickup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_pickupScheduleId_fkey" FOREIGN KEY ("pickupScheduleId") REFERENCES "PickupSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
