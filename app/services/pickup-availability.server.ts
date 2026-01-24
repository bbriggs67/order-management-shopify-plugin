import prisma from "../db.server";
import type { PickupConfig, PickupDayConfig, TimeSlot } from "@prisma/client";

// ============================================
// Types
// ============================================

export interface PickupAvailabilityData {
  pickupConfig: PickupConfig;
  dayConfigs: PickupDayConfig[];
  timeSlots: TimeSlot[];
}

export type AvailabilityMode = "customize_by_day" | "same_for_all";

// ============================================
// Time Utilities
// ============================================

export function formatTime12h(time: string): string {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const period = hour >= 12 ? "PM" : "AM";
  return `${displayHour}:${minutes} ${period}`;
}

export function generateSlotLabel(startTime: string, endTime: string): string {
  return `${formatTime12h(startTime)} - ${formatTime12h(endTime)}`;
}

export function generateTimeOptions(intervalMinutes: number = 30): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += intervalMinutes) {
      const value = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
      options.push({ value, label: formatTime12h(value) });
    }
  }
  return options;
}

// ============================================
// Data Access Functions
// ============================================

const DAY_DEFAULTS = [
  { dayOfWeek: 0, isEnabled: false }, // Sunday
  { dayOfWeek: 1, isEnabled: false }, // Monday
  { dayOfWeek: 2, isEnabled: true },  // Tuesday
  { dayOfWeek: 3, isEnabled: true },  // Wednesday
  { dayOfWeek: 4, isEnabled: false }, // Thursday
  { dayOfWeek: 5, isEnabled: true },  // Friday
  { dayOfWeek: 6, isEnabled: true },  // Saturday
];

export async function getPickupAvailabilityData(shop: string): Promise<PickupAvailabilityData> {
  // Ensure PickupConfig exists
  const pickupConfig = await prisma.pickupConfig.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      availabilityMode: "customize_by_day",
    },
  });

  // Ensure all 7 day configs exist
  const dayConfigs = await ensureDayConfigs(shop);

  // Get all time slots for this shop, sorted by start time ascending
  const timeSlots = await prisma.timeSlot.findMany({
    where: { shop },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });

  return { pickupConfig, dayConfigs, timeSlots };
}

async function ensureDayConfigs(shop: string): Promise<PickupDayConfig[]> {
  const existing = await prisma.pickupDayConfig.findMany({
    where: { shop },
    orderBy: { dayOfWeek: "asc" },
  });

  const existingDays = new Set(existing.map((d) => d.dayOfWeek));

  // Create missing day configs
  for (const { dayOfWeek, isEnabled } of DAY_DEFAULTS) {
    if (!existingDays.has(dayOfWeek)) {
      await prisma.pickupDayConfig.create({
        data: {
          shop,
          dayOfWeek,
          isEnabled,
          maxOrders: null,
        },
      });
    }
  }

  return prisma.pickupDayConfig.findMany({
    where: { shop },
    orderBy: { dayOfWeek: "asc" },
  });
}

export async function updateAvailabilityMode(
  shop: string,
  availabilityMode: AvailabilityMode
): Promise<PickupConfig> {
  return prisma.pickupConfig.update({
    where: { shop },
    data: { availabilityMode },
  });
}

export async function toggleDayEnabled(
  shop: string,
  dayOfWeek: number,
  isEnabled: boolean
): Promise<PickupDayConfig> {
  return prisma.pickupDayConfig.update({
    where: { shop_dayOfWeek: { shop, dayOfWeek } },
    data: { isEnabled },
  });
}

export async function updateDayMaxOrders(
  shop: string,
  dayOfWeek: number,
  maxOrders: number | null
): Promise<PickupDayConfig> {
  return prisma.pickupDayConfig.update({
    where: { shop_dayOfWeek: { shop, dayOfWeek } },
    data: { maxOrders },
  });
}

export async function addTimeSlot(
  shop: string,
  data: {
    dayOfWeek: number | null;
    startTime: string;
    endTime: string;
    maxOrders?: number | null;
  }
): Promise<TimeSlot> {
  const label = generateSlotLabel(data.startTime, data.endTime);

  // Get max sortOrder for this day
  const maxSort = await prisma.timeSlot.aggregate({
    where: { shop, dayOfWeek: data.dayOfWeek },
    _max: { sortOrder: true },
  });

  return prisma.timeSlot.create({
    data: {
      shop,
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      label,
      maxOrders: data.maxOrders ?? null,
      isActive: true,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });
}

export async function updateTimeSlot(
  shop: string,
  slotId: string,
  updates: {
    startTime?: string;
    endTime?: string;
    maxOrders?: number | null;
  }
): Promise<TimeSlot> {
  // Verify slot belongs to shop
  const existing = await prisma.timeSlot.findFirst({
    where: { id: slotId, shop },
  });

  if (!existing) {
    throw new Error("Time slot not found");
  }

  const data: any = { ...updates };

  // Regenerate label if times changed
  if (updates.startTime || updates.endTime) {
    const startTime = updates.startTime ?? existing.startTime;
    const endTime = updates.endTime ?? existing.endTime;
    data.label = generateSlotLabel(startTime, endTime);
  }

  return prisma.timeSlot.update({
    where: { id: slotId },
    data,
  });
}

export async function removeTimeSlot(shop: string, slotId: string): Promise<void> {
  // Verify slot belongs to shop before deleting
  const existing = await prisma.timeSlot.findFirst({
    where: { id: slotId, shop },
  });

  if (!existing) {
    throw new Error("Time slot not found");
  }

  await prisma.timeSlot.delete({
    where: { id: slotId },
  });
}

export async function copyTimeSlotsFromDay(
  shop: string,
  sourceDay: number,
  targetDay: number
): Promise<void> {
  // Get source day's time slots
  const sourceSlots = await prisma.timeSlot.findMany({
    where: { shop, dayOfWeek: sourceDay },
    orderBy: { sortOrder: "asc" },
  });

  // Delete existing target day's time slots
  await prisma.timeSlot.deleteMany({
    where: { shop, dayOfWeek: targetDay },
  });

  // Copy source slots to target day
  if (sourceSlots.length > 0) {
    const newSlots = sourceSlots.map((slot, index) => ({
      shop,
      dayOfWeek: targetDay,
      startTime: slot.startTime,
      endTime: slot.endTime,
      label: slot.label,
      maxOrders: slot.maxOrders,
      isActive: slot.isActive,
      sortOrder: index,
    }));

    await prisma.timeSlot.createMany({ data: newSlots });
  }

  // Optionally copy day config (maxOrders)
  const sourceDayConfig = await prisma.pickupDayConfig.findUnique({
    where: { shop_dayOfWeek: { shop, dayOfWeek: sourceDay } },
  });

  if (sourceDayConfig) {
    await prisma.pickupDayConfig.update({
      where: { shop_dayOfWeek: { shop, dayOfWeek: targetDay } },
      data: {
        maxOrders: sourceDayConfig.maxOrders,
      },
    });
  }
}

// ============================================
// Mode Transition Functions
// ============================================

export async function consolidateTimeSlotsToAllDays(shop: string): Promise<void> {
  // When switching to "same_for_all", take slots from the first enabled day with slots
  const existingSlots = await prisma.timeSlot.findMany({
    where: { shop, dayOfWeek: { not: null } },
    orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }],
  });

  if (existingSlots.length === 0) return;

  // Group by day to find first day with slots
  const slotsByDay = existingSlots.reduce(
    (acc, slot) => {
      const day = slot.dayOfWeek!;
      if (!acc[day]) acc[day] = [];
      acc[day].push(slot);
      return acc;
    },
    {} as Record<number, typeof existingSlots>
  );

  const firstDayWithSlots = Object.keys(slotsByDay)[0];
  const templateSlots = firstDayWithSlots ? slotsByDay[parseInt(firstDayWithSlots)] : [];

  // Delete all day-specific slots
  await prisma.timeSlot.deleteMany({
    where: { shop, dayOfWeek: { not: null } },
  });

  // Create "all days" slots (dayOfWeek = null)
  if (templateSlots.length > 0) {
    const allDaySlots = templateSlots.map((slot, index) => ({
      shop,
      dayOfWeek: null,
      startTime: slot.startTime,
      endTime: slot.endTime,
      label: slot.label,
      maxOrders: slot.maxOrders,
      isActive: slot.isActive,
      sortOrder: index,
    }));

    await prisma.timeSlot.createMany({ data: allDaySlots });
  }
}

export async function expandTimeSlotsToAllDays(shop: string): Promise<void> {
  // When switching to "customize_by_day", copy "all days" slots to each enabled day
  const allDaySlots = await prisma.timeSlot.findMany({
    where: { shop, dayOfWeek: null },
    orderBy: { sortOrder: "asc" },
  });

  if (allDaySlots.length === 0) return;

  // Get enabled days
  const enabledDays = await prisma.pickupDayConfig.findMany({
    where: { shop, isEnabled: true },
  });

  // Delete the "all days" slots
  await prisma.timeSlot.deleteMany({
    where: { shop, dayOfWeek: null },
  });

  // Create slots for each enabled day
  const newSlots: Array<{
    shop: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    label: string;
    maxOrders: number | null;
    isActive: boolean;
    sortOrder: number;
  }> = [];

  for (const dayConfig of enabledDays) {
    for (let i = 0; i < allDaySlots.length; i++) {
      const slot = allDaySlots[i];
      newSlots.push({
        shop,
        dayOfWeek: dayConfig.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        label: slot.label,
        maxOrders: slot.maxOrders,
        isActive: slot.isActive,
        sortOrder: i,
      });
    }
  }

  if (newSlots.length > 0) {
    await prisma.timeSlot.createMany({ data: newSlots });
  }
}
