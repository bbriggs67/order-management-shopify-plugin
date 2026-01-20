import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import {
  getNowInPacific,
  getCurrentTimePacific,
  getDatePacific,
  formatDateISOPacific,
  formatDatePacific,
  getDayOfWeekPacific,
  isBeforeTimePacific,
  SHOP_TIMEZONE,
} from "../utils/timezone.server";

// CORS headers for checkout extension
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle OPTIONS preflight request
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
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

// Day names for reference
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Get shop from query parameter (passed by checkout extension)
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ error: "Shop parameter required" }, { status: 400, headers: corsHeaders });
  }

  // Verify shop exists in our database (has installed the app)
  const session = await prisma.session.findFirst({
    where: { shop },
  });

  if (!session) {
    return json({ error: "Shop not found" }, { status: 404, headers: corsHeaders });
  }

  // Fetch all configuration data
  const [prepConfig, pickupDaysConfig, timeSlots, locations, blackouts] = await Promise.all([
    prisma.prepTimeConfig.findUnique({ where: { shop } }),
    prisma.pickupDayConfig.findUnique({ where: { shop } }),
    prisma.timeSlot.findMany({
      where: { shop, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { startTime: "asc" }],
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

  const pickupDays = pickupDaysConfig || {
    sunday: false,
    monday: false,
    tuesday: true,
    wednesday: true,
    thursday: false,
    friday: true,
    saturday: true,
  };

  // Calculate available dates using Pacific timezone
  const nowPacific = getNowInPacific();
  const { totalMinutes: currentTimeMinutes } = getCurrentTimePacific();

  // Parse cut-off time
  const [cutOffHour, cutOffMinute] = prepTime.cutOffTime.split(":").map(Number);
  const cutOffMinutes = cutOffHour * 60 + cutOffMinute;

  // Determine if we're before or after cut-off (in Pacific time)
  const isBeforeCutOff = currentTimeMinutes < cutOffMinutes;

  // Calculate earliest pickup date
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

  // Build pickup days map
  const pickupDaysMap: Record<number, boolean> = {
    0: pickupDays.sunday,
    1: pickupDays.monday,
    2: pickupDays.tuesday,
    3: pickupDays.wednesday,
    4: pickupDays.thursday,
    5: pickupDays.friday,
    6: pickupDays.saturday,
  };

  // Check if a date is blacked out
  const isDateBlackedOut = (date: Date, timeSlot?: TimeSlot): boolean => {
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);
    const dayOfWeek = getDayOfWeekPacific(date);

    for (const blackout of blackouts) {
      // Check recurring weekly blackouts
      if (blackout.isRecurring && blackout.dayOfWeek === dayOfWeek) {
        // If blackout has time window, check if time slot overlaps
        if (blackout.startTime && blackout.endTime && timeSlot) {
          if (timeOverlaps(timeSlot.startTime, timeSlot.endTime, blackout.startTime, blackout.endTime)) {
            return true;
          }
        } else {
          // Full day blackout
          return true;
        }
      }

      // Check specific date blackouts
      if (blackout.date) {
        const blackoutDate = new Date(blackout.date);
        blackoutDate.setHours(0, 0, 0, 0);

        // Check date range
        if (blackout.dateEnd) {
          const blackoutEnd = new Date(blackout.dateEnd);
          blackoutEnd.setHours(23, 59, 59, 999);
          if (dateOnly >= blackoutDate && dateOnly <= blackoutEnd) {
            // Check time window if specified
            if (blackout.startTime && blackout.endTime && timeSlot) {
              if (timeOverlaps(timeSlot.startTime, timeSlot.endTime, blackout.startTime, blackout.endTime)) {
                return true;
              }
            } else {
              return true;
            }
          }
        } else {
          // Single date
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

  // Helper to check time overlap
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

  // Get time slots for a specific day
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

    // Get the date in Pacific timezone
    const checkDate = getDatePacific(daysAhead);
    checkDate.setHours(12, 0, 0, 0); // Normalize to noon

    const dayOfWeek = getDayOfWeekPacific(checkDate);

    // Check if this day of week is a pickup day
    if (!pickupDaysMap[dayOfWeek]) continue;

    // Calculate minimum lead time for this day
    const leadDays = getLeadDays(dayOfWeek);
    const minLeadDays = isBeforeCutOff ? leadDays.before : leadDays.after;

    // Check if we've passed the minimum lead time
    if (daysAhead < minLeadDays) continue;

    // Check if entire day is blacked out
    if (isDateBlackedOut(checkDate)) continue;

    // Get available time slots for this day
    const dayTimeSlots = getTimeSlotsForDay(dayOfWeek);

    // Filter out blacked-out time slots
    const availableSlots = dayTimeSlots.filter(
      (slot) => !isDateBlackedOut(checkDate, slot)
    );

    // Only include day if it has available time slots
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

  return json({
    availableDates,
    locations: formattedLocations,
    defaultLocationId: defaultLocation?.id || formattedLocations[0]?.id || null,
    timezone: SHOP_TIMEZONE,
  }, { headers: corsHeaders });
};
