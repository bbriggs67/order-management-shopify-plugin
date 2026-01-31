/**
 * Pickup Availability API for storefront (via App Proxy)
 *
 * This endpoint is accessible via Shopify's app proxy at:
 * https://yourstore.com/apps/my-subscription/pickup-availability
 *
 * Shopify's app proxy forwards the request to:
 * https://yourapp.com/apps/pickup-availability
 * (The "my-subscription" subpath is stripped by the proxy)
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import {
  getNowInPacific,
  getCurrentTimePacific,
  getDatePacific,
  formatDateISOPacific,
  formatDatePacific,
  getDayOfWeekPacific,
  SHOP_TIMEZONE,
} from "../utils/timezone.server";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

interface TimeSlot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
}

interface AvailableDate {
  date: string;
  dayOfWeek: number;
  dayName: string;
  displayDate: string;
  timeSlots: TimeSlot[];
}

interface PickupLocation {
  id: string;
  name: string;
  address: string;
  isDefault: boolean;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shop can come from query param or from Shopify's app proxy headers
  let shop = url.searchParams.get("shop");

  // Clean up shop domain if needed
  if (shop && !shop.includes(".myshopify.com")) {
    shop = `${shop}.myshopify.com`;
  }

  console.log("Pickup availability request for shop:", shop);

  if (!shop) {
    return json({
      error: "Shop parameter required",
      availableDates: [],
      locations: [],
    }, { status: 400, headers: corsHeaders });
  }

  // Verify shop exists
  const session = await prisma.session.findFirst({
    where: { shop },
  });

  if (!session) {
    console.log("Shop not found in database:", shop);
    return json({
      error: "Shop not found",
      availableDates: [],
      locations: [],
    }, { status: 404, headers: corsHeaders });
  }

  // Fetch all configuration data
  const [prepConfig, pickupDayConfigs, timeSlots, locations, blackouts] = await Promise.all([
    prisma.prepTimeConfig.findUnique({ where: { shop } }),
    prisma.pickupDayConfig.findMany({ where: { shop } }),
    prisma.timeSlot.findMany({
      where: { shop, isActive: true },
      orderBy: [{ startTime: "asc" }],
    }),
    prisma.pickupLocation.findMany({
      where: { shop, isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.blackoutDate.findMany({
      where: { shop, isActive: true },
    }),
  ]);

  // Default configuration if none exists
  const prepTime = prepConfig || {
    isEnabled: true,
    cutOffTime: "12:00",
    leadTimeBefore: 3,
    leadTimeAfter: 4,
    maxBookingDays: 14,
    customByDay: false,
  };

  // Build pickup days map
  const defaultEnabledDays = new Set([2, 3, 5, 6]); // Tue, Wed, Fri, Sat
  const pickupDaysMap: Record<number, boolean> = {};

  if (pickupDayConfigs.length > 0) {
    for (let day = 0; day <= 6; day++) {
      const config = pickupDayConfigs.find((c) => c.dayOfWeek === day);
      pickupDaysMap[day] = config?.isEnabled ?? false;
    }
  } else {
    for (let day = 0; day <= 6; day++) {
      pickupDaysMap[day] = defaultEnabledDays.has(day);
    }
  }

  // Calculate available dates
  const { totalMinutes: currentTimeMinutes } = getCurrentTimePacific();

  const [cutOffHour, cutOffMinute] = prepTime.cutOffTime.split(":").map(Number);
  const cutOffMinutes = cutOffHour * 60 + cutOffMinute;
  const isBeforeCutOff = currentTimeMinutes < cutOffMinutes;

  const getLeadDays = (dayOfWeek: number): { before: number; after: number } => {
    if (prepTime.customByDay) {
      const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const dayKey = dayNames[dayOfWeek];
      const beforeKey = `${dayKey}Before` as keyof typeof prepTime;
      const afterKey = `${dayKey}After` as keyof typeof prepTime;
      return {
        before: (prepTime[beforeKey] as number | null) ?? prepTime.leadTimeBefore,
        after: (prepTime[afterKey] as number | null) ?? prepTime.leadTimeAfter,
      };
    }
    return {
      before: prepTime.leadTimeBefore,
      after: prepTime.leadTimeAfter,
    };
  };

  const timeOverlaps = (start1: string, end1: string, start2: string, end2: string): boolean => {
    const toMinutes = (time: string) => {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    };
    const s1 = toMinutes(start1);
    const e1 = toMinutes(end1);
    const s2 = toMinutes(start2);
    const e2 = toMinutes(end2);
    return s1 < e2 && e1 > s2;
  };

  const isDateBlackedOut = (date: Date, timeSlot?: TimeSlot): boolean => {
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);
    const dayOfWeek = getDayOfWeekPacific(date);

    for (const blackout of blackouts) {
      if (blackout.isRecurring && blackout.dayOfWeek === dayOfWeek) {
        if (blackout.startTime && blackout.endTime && timeSlot) {
          if (timeOverlaps(timeSlot.startTime, timeSlot.endTime, blackout.startTime, blackout.endTime)) {
            return true;
          }
        } else {
          return true;
        }
      }

      if (blackout.date) {
        const blackoutDate = new Date(blackout.date);
        blackoutDate.setHours(0, 0, 0, 0);

        if (blackout.dateEnd) {
          const blackoutEnd = new Date(blackout.dateEnd);
          blackoutEnd.setHours(23, 59, 59, 999);
          if (dateOnly >= blackoutDate && dateOnly <= blackoutEnd) {
            if (blackout.startTime && blackout.endTime && timeSlot) {
              if (timeOverlaps(timeSlot.startTime, timeSlot.endTime, blackout.startTime, blackout.endTime)) {
                return true;
              }
            } else {
              return true;
            }
          }
        } else {
          if (dateOnly.getTime() === blackoutDate.getTime()) {
            if (blackout.startTime && blackout.endTime && timeSlot) {
              if (timeOverlaps(timeSlot.startTime, timeSlot.endTime, blackout.startTime, blackout.endTime)) {
                return true;
              }
            } else {
              return true;
            }
          }
        }
      }
    }
    return false;
  };

  const getTimeSlotsForDay = (dayOfWeek: number): TimeSlot[] => {
    return timeSlots
      .filter((slot) => slot.dayOfWeek === null || slot.dayOfWeek === dayOfWeek)
      .map((slot) => ({
        id: slot.id,
        label: slot.label,
        startTime: slot.startTime,
        endTime: slot.endTime,
      }));
  };

  // Generate available dates
  const availableDates: AvailableDate[] = [];
  const maxDays = prepTime.maxBookingDays;

  for (let daysAhead = 0; daysAhead <= maxDays + 14; daysAhead++) {
    if (availableDates.length >= maxDays) break;

    const checkDate = getDatePacific(daysAhead);
    checkDate.setHours(12, 0, 0, 0);

    const dayOfWeek = getDayOfWeekPacific(checkDate);

    if (!pickupDaysMap[dayOfWeek]) continue;

    const leadDays = getLeadDays(dayOfWeek);
    const minLeadDays = isBeforeCutOff ? leadDays.before : leadDays.after;

    if (daysAhead < minLeadDays) continue;

    if (isDateBlackedOut(checkDate)) continue;

    const dayTimeSlots = getTimeSlotsForDay(dayOfWeek);
    const availableSlots = dayTimeSlots.filter(
      (slot) => !isDateBlackedOut(checkDate, slot)
    );

    if (availableSlots.length === 0) continue;

    availableDates.push({
      date: formatDateISOPacific(checkDate),
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek],
      displayDate: formatDatePacific(checkDate),
      timeSlots: availableSlots,
    });
  }

  // Format locations
  const formattedLocations: PickupLocation[] = locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    address: loc.address,
    isDefault: loc.isDefault,
  }));

  const defaultLocation = formattedLocations.find((l) => l.isDefault);

  console.log(`Returning ${availableDates.length} available dates for ${shop}`);

  return json({
    availableDates,
    locations: formattedLocations,
    defaultLocationId: defaultLocation?.id || formattedLocations[0]?.id || null,
    timezone: SHOP_TIMEZONE,
  }, { headers: corsHeaders });
};
