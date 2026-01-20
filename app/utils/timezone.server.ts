/**
 * Timezone utilities for Susie's Sourdough
 * All business operations are in Pacific Time (San Diego)
 */

// Pacific timezone identifier
export const SHOP_TIMEZONE = "America/Los_Angeles";

/**
 * Get current date/time in Pacific timezone
 */
export function getNowInPacific(): Date {
  // Create a date string in Pacific time and parse it back
  const now = new Date();
  const pacificString = now.toLocaleString("en-US", { timeZone: SHOP_TIMEZONE });
  return new Date(pacificString);
}

/**
 * Get the current hour and minute in Pacific timezone
 */
export function getCurrentTimePacific(): { hour: number; minute: number; totalMinutes: number } {
  const now = new Date();
  const pacificTime = new Date(now.toLocaleString("en-US", { timeZone: SHOP_TIMEZONE }));
  const hour = pacificTime.getHours();
  const minute = pacificTime.getMinutes();
  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

/**
 * Get today's date at midnight in Pacific timezone
 */
export function getTodayPacific(): Date {
  const pacific = getNowInPacific();
  pacific.setHours(0, 0, 0, 0);
  return pacific;
}

/**
 * Get a date X days from now in Pacific timezone
 */
export function getDatePacific(daysFromNow: number): Date {
  const pacific = getTodayPacific();
  pacific.setDate(pacific.getDate() + daysFromNow);
  return pacific;
}

/**
 * Format a date for display in Pacific timezone
 */
export function formatDatePacific(date: Date, options?: Intl.DateTimeFormatOptions): string {
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: SHOP_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  };
  return date.toLocaleDateString("en-US", { ...defaultOptions, ...options });
}

/**
 * Format a date as ISO string (YYYY-MM-DD) in Pacific timezone
 */
export function formatDateISOPacific(date: Date): string {
  const pacificDate = new Date(date.toLocaleString("en-US", { timeZone: SHOP_TIMEZONE }));
  const year = pacificDate.getFullYear();
  const month = String(pacificDate.getMonth() + 1).padStart(2, "0");
  const day = String(pacificDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get day of week (0=Sunday, 6=Saturday) in Pacific timezone
 */
export function getDayOfWeekPacific(date: Date): number {
  const pacificDate = new Date(date.toLocaleString("en-US", { timeZone: SHOP_TIMEZONE }));
  return pacificDate.getDay();
}

/**
 * Check if a date is today in Pacific timezone
 */
export function isTodayPacific(date: Date): boolean {
  const today = getTodayPacific();
  const checkDate = new Date(date.toLocaleString("en-US", { timeZone: SHOP_TIMEZONE }));
  checkDate.setHours(0, 0, 0, 0);
  return today.getTime() === checkDate.getTime();
}

/**
 * Get start and end of today in UTC (for database queries)
 * Returns times that correspond to Pacific timezone day boundaries
 */
export function getTodayBoundariesUTC(): { start: Date; end: Date } {
  // Get today in Pacific
  const pacific = getNowInPacific();
  const year = pacific.getFullYear();
  const month = pacific.getMonth();
  const day = pacific.getDate();

  // Create start of day in Pacific, then get UTC equivalent
  const startPacific = new Date(year, month, day, 0, 0, 0, 0);
  const endPacific = new Date(year, month, day, 23, 59, 59, 999);

  // Convert to UTC by creating dates with the Pacific offset
  // PST is UTC-8, PDT is UTC-7
  const offset = getTimezoneOffsetMinutes();

  const startUTC = new Date(startPacific.getTime() + offset * 60 * 1000);
  const endUTC = new Date(endPacific.getTime() + offset * 60 * 1000);

  return { start: startUTC, end: endUTC };
}

/**
 * Get the current timezone offset in minutes for Pacific time
 */
function getTimezoneOffsetMinutes(): number {
  const now = new Date();
  const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const pacificDate = new Date(now.toLocaleString("en-US", { timeZone: SHOP_TIMEZONE }));
  return (utcDate.getTime() - pacificDate.getTime()) / (60 * 1000);
}

/**
 * Parse a time string (HH:MM) and compare with current Pacific time
 */
export function isBeforeTimePacific(timeString: string): boolean {
  const [hour, minute] = timeString.split(":").map(Number);
  const targetMinutes = hour * 60 + minute;
  const { totalMinutes } = getCurrentTimePacific();
  return totalMinutes < targetMinutes;
}
