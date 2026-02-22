-- Add SMS forwarding fields to NotificationSettings
-- Allows admin to configure forwarding of inbound customer texts to a personal phone
ALTER TABLE "NotificationSettings" ADD COLUMN "smsForwardingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationSettings" ADD COLUMN "smsForwardingPhone" TEXT;
