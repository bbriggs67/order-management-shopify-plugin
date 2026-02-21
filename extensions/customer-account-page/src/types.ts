export interface CustomerSubscription {
  id: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";
  preferredDay: number; // 0-6 (Sun-Sat)
  preferredTimeSlot: string; // e.g., "12:00 PM - 2:00 PM"
  discountPercent: number;
  nextPickupDate: string | null;
  pausedUntil: string | null;
  pauseReason: string | null;
  oneTimeRescheduleDate: string | null;
  oneTimeRescheduleTimeSlot: string | null;
  oneTimeRescheduleReason: string | null;
}

export interface AvailableTimeSlot {
  label: string;
  startTime: string;
}

export interface SubscriptionData {
  subscriptions: CustomerSubscription[];
  availableDays: number[];
  availableTimeSlots: AvailableTimeSlot[];
  customerEmail: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  subscription?: CustomerSubscription;
}
