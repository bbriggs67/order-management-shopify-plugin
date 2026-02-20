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
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function getDayName(day: number): string {
  return DAY_NAMES[day] || "Unknown";
}
