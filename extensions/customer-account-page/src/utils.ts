export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 Weeks",
  TRIWEEKLY: "Every 3 Weeks",
};

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Not scheduled";
  // If bare date (YYYY-MM-DD), append T12:00:00 to avoid UTC midnight → previous day in Pacific
  const safeDateStr =
    dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr;
  const date = new Date(safeDateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

export function getDayName(day: number): string {
  return DAY_NAMES[day] || "Unknown";
}
