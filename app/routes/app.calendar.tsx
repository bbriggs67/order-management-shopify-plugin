import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSearchParams,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  InlineGrid,
  Tabs,
  TextField,
  Select,
  Divider,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useCallback, useState, useMemo } from "react";

// ============================================
// DAY HEADERS (hardcoded bakery schedule)
// ============================================
const DAY_HEADERS: Record<number, { label: string; tone: "warning" | "success" | "read-only" | "info" }> = {
  0: { label: "Day Off", tone: "read-only" },       // Sunday
  1: { label: "Dough Prep Day", tone: "warning" },  // Monday
  2: { label: "Bake Day", tone: "success" },         // Tuesday
  3: { label: "Bake Day", tone: "success" },         // Wednesday
  4: { label: "Dough Prep Day", tone: "warning" },  // Thursday
  5: { label: "Bake Day", tone: "success" },         // Friday
  6: { label: "Bake Day", tone: "success" },         // Saturday
};

// Prep day → bake day mapping: Mon→Tue+Wed, Thu→Fri+Sat
const PREP_TO_BAKE_DAYS: Record<number, number[]> = {
  1: [2, 3], // Monday prep → Tuesday + Wednesday bake
  4: [5, 6], // Thursday prep → Friday + Saturday bake
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ============================================
// HELPER: format date key (YYYY-MM-DD)
// ============================================
function dateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseLocalDate(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 12, 0, 0); // noon to avoid TZ issues
}

// Get Monday of the week containing the given date
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Sunday → go back 6 days
  date.setDate(date.getDate() + diff);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return new Date(result.getFullYear(), result.getMonth(), result.getDate(), 12, 0, 0);
}

function formatDateLong(d: Date): string {
  return `${DAY_NAMES_FULL[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatDateShort(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()].substring(0, 3)} ${d.getDate()}`;
}

// ============================================
// STATUS BADGE HELPER
// ============================================
function statusTone(status: string): "info" | "success" | "warning" | "critical" | "attention" | undefined {
  switch (status) {
    case "SCHEDULED": return "info";
    case "READY": return "success";
    case "PICKED_UP": return undefined;
    case "CANCELLED": return "critical";
    case "NO_SHOW": return "warning";
    default: return undefined;
  }
}

// ============================================
// TYPES
// ============================================
interface OrderItemData {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
}

interface PickupData {
  id: string;
  shopifyOrderNumber: string;
  customerName: string;
  pickupDate: string;
  pickupTimeSlot: string;
  pickupStatus: string;
  notes: string | null;
  orderItems: OrderItemData[];
  subscriptionPickup: {
    id: string;
    status: string;
    customerName: string;
  } | null;
}

interface ExtraBakeOrderData {
  id: string;
  date: string;
  timeSlot: string;
  shopifyProductId: string;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  quantity: number;
  notes: string | null;
}

interface TimeSlotData {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
}

interface PrepSummaryItem {
  productTitle: string;
  totalQty: number;
}

interface LoaderData {
  view: string;
  year: number;
  month: number;
  day: number;
  weekStart: string;
  pickupsByDate: Record<string, PickupData[]>;
  extraOrdersByDate: Record<string, ExtraBakeOrderData[]>;
  blackoutDates: Array<{
    id: string;
    date: string | null;
    dateEnd: string | null;
    dayOfWeek: number | null;
    isRecurring: boolean;
    reason: string | null;
  }>;
  prepSummaries: Record<string, PrepSummaryItem[]>;
  timeSlots: TimeSlotData[];
  pickupStats: {
    total: number;
    scheduled: number;
    ready: number;
    pickedUp: number;
    fromPausedSubs: number;
  };
}

// ============================================
// LOADER
// ============================================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "month";
  const now = new Date();

  const yearParam = url.searchParams.get("year");
  const monthParam = url.searchParams.get("month");
  const dayParam = url.searchParams.get("day");
  const weekStartParam = url.searchParams.get("weekStart");

  const year = yearParam ? parseInt(yearParam) : now.getFullYear();
  const month = monthParam ? parseInt(monthParam) : now.getMonth();
  const day = dayParam ? parseInt(dayParam) : now.getDate();

  // Calculate date range based on view
  let rangeStart: Date;
  let rangeEnd: Date;
  let weekStart: string;

  if (view === "week") {
    const baseDate = weekStartParam
      ? new Date(weekStartParam + "T12:00:00")
      : getMonday(parseLocalDate(year, month, day));
    rangeStart = baseDate;
    rangeEnd = addDays(baseDate, 6);
    weekStart = dateKey(baseDate);
  } else if (view === "day") {
    rangeStart = parseLocalDate(year, month, day);
    rangeEnd = rangeStart;
    weekStart = dateKey(getMonday(rangeStart));
  } else {
    // month view
    rangeStart = new Date(year, month, 1);
    rangeEnd = new Date(year, month + 1, 0);
    weekStart = dateKey(getMonday(parseLocalDate(year, month, day)));
  }

  // Set time boundaries for query
  const queryStart = new Date(rangeStart);
  queryStart.setHours(0, 0, 0, 0);
  const queryEnd = new Date(rangeEnd);
  queryEnd.setHours(23, 59, 59, 999);

  // For prep summaries, we may need data beyond the current range
  // Monday prep needs Tue+Wed, Thursday prep needs Fri+Sat
  const prepQueryEnd = new Date(queryEnd);
  prepQueryEnd.setDate(prepQueryEnd.getDate() + 2); // up to 2 extra days

  // Parallel queries
  const [pickups, extraOrders, blackoutDates, timeSlots] = await Promise.all([
    prisma.pickupSchedule.findMany({
      where: {
        shop,
        pickupDate: { gte: queryStart, lte: prepQueryEnd },
        pickupStatus: { not: "CANCELLED" },
      },
      include: {
        orderItems: true,
        subscriptionPickup: {
          select: { id: true, status: true, customerName: true },
        },
      },
      orderBy: { pickupDate: "asc" },
    }),
    prisma.extraBakeOrder.findMany({
      where: {
        shop,
        date: { gte: queryStart, lte: prepQueryEnd },
      },
      orderBy: { date: "asc" },
    }),
    prisma.blackoutDate.findMany({
      where: {
        shop,
        isActive: true,
        OR: [
          { date: { gte: queryStart, lte: queryEnd } },
          { isRecurring: true },
        ],
      },
    }),
    prisma.timeSlot.findMany({
      where: { shop, isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  // Filter out cancelled subscription pickups
  const filteredPickups = pickups.filter((pickup) => {
    if (!pickup.subscriptionPickup) return true;
    if (pickup.subscriptionPickup.status === "CANCELLED") return false;
    return true;
  });

  // Group pickups by date
  const pickupsByDate: Record<string, PickupData[]> = {};
  filteredPickups.forEach((pickup) => {
    const dk = dateKey(new Date(pickup.pickupDate));
    if (!pickupsByDate[dk]) pickupsByDate[dk] = [];
    pickupsByDate[dk].push({
      id: pickup.id,
      shopifyOrderNumber: pickup.shopifyOrderNumber,
      customerName: pickup.customerName,
      pickupDate: pickup.pickupDate.toISOString(),
      pickupTimeSlot: pickup.pickupTimeSlot,
      pickupStatus: pickup.pickupStatus,
      notes: pickup.notes,
      orderItems: pickup.orderItems.map((item) => ({
        id: item.id,
        productTitle: item.productTitle,
        variantTitle: item.variantTitle,
        quantity: item.quantity,
      })),
      subscriptionPickup: pickup.subscriptionPickup
        ? {
            id: pickup.subscriptionPickup.id,
            status: pickup.subscriptionPickup.status,
            customerName: pickup.subscriptionPickup.customerName,
          }
        : null,
    });
  });

  // Group extra orders by date
  const extraOrdersByDate: Record<string, ExtraBakeOrderData[]> = {};
  extraOrders.forEach((order) => {
    const dk = dateKey(new Date(order.date));
    if (!extraOrdersByDate[dk]) extraOrdersByDate[dk] = [];
    extraOrdersByDate[dk].push({
      id: order.id,
      date: order.date.toISOString(),
      timeSlot: order.timeSlot,
      shopifyProductId: order.shopifyProductId,
      productTitle: order.productTitle,
      variantTitle: order.variantTitle,
      imageUrl: order.imageUrl,
      quantity: order.quantity,
      notes: order.notes,
    });
  });

  // Compute prep summaries for prep days (Mon/Thu) in the range
  const prepSummaries: Record<string, PrepSummaryItem[]> = {};

  // Iterate each day in the visible range
  const cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const dow = cursor.getDay();
    const bakeDays = PREP_TO_BAKE_DAYS[dow];
    if (bakeDays) {
      // This is a prep day - aggregate products from bake days
      const productMap = new Map<string, number>();

      for (const offset of bakeDays) {
        const bakeDate = addDays(cursor, offset - dow >= 0 ? offset - dow : offset - dow + 7);
        // Actually: Mon(1) → Tue(2),Wed(3), offset-dow = 1,2
        // Thu(4) → Fri(5),Sat(6), offset-dow = 1,2
        const actualBakeDate = addDays(cursor, offset - dow);
        const bdKey = dateKey(actualBakeDate);

        // Aggregate pickups
        const dayPickups = pickupsByDate[bdKey] || [];
        for (const pickup of dayPickups) {
          for (const item of pickup.orderItems) {
            const key = item.variantTitle
              ? `${item.productTitle} (${item.variantTitle})`
              : item.productTitle;
            productMap.set(key, (productMap.get(key) || 0) + item.quantity);
          }
        }

        // Aggregate extra bake orders
        const dayExtras = extraOrdersByDate[bdKey] || [];
        for (const extra of dayExtras) {
          const key = extra.variantTitle
            ? `${extra.productTitle} (${extra.variantTitle})`
            : extra.productTitle;
          productMap.set(key, (productMap.get(key) || 0) + extra.quantity);
        }
      }

      if (productMap.size > 0) {
        const dk = dateKey(cursor);
        prepSummaries[dk] = Array.from(productMap.entries())
          .map(([productTitle, totalQty]) => ({ productTitle, totalQty }))
          .sort((a, b) => a.productTitle.localeCompare(b.productTitle));
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Pickup stats (for the visible range only)
  const visiblePickups = filteredPickups.filter((p) => {
    const d = new Date(p.pickupDate);
    return d >= queryStart && d <= queryEnd;
  });

  const pickupStats = {
    total: visiblePickups.length,
    scheduled: visiblePickups.filter((p) => p.pickupStatus === "SCHEDULED").length,
    ready: visiblePickups.filter((p) => p.pickupStatus === "READY").length,
    pickedUp: visiblePickups.filter((p) => p.pickupStatus === "PICKED_UP").length,
    fromPausedSubs: visiblePickups.filter(
      (p) => p.subscriptionPickup?.status === "PAUSED"
    ).length,
  };

  // Serialize blackout dates
  const serializedBlackouts = blackoutDates.map((b) => ({
    id: b.id,
    date: b.date?.toISOString() || null,
    dateEnd: b.dateEnd?.toISOString() || null,
    dayOfWeek: b.dayOfWeek,
    isRecurring: b.isRecurring,
    reason: b.reason,
  }));

  return json<LoaderData>({
    view,
    year,
    month,
    day,
    weekStart,
    pickupsByDate,
    extraOrdersByDate,
    blackoutDates: serializedBlackouts,
    prepSummaries,
    timeSlots: timeSlots.map((ts) => ({
      id: ts.id,
      label: ts.label,
      startTime: ts.startTime,
      endTime: ts.endTime,
    })),
    pickupStats,
  });
};

// ============================================
// ACTION
// ============================================
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action") as string;

  if (intent === "add_extra_order") {
    const productDataStr = formData.get("productData") as string;
    const quantity = parseInt(formData.get("quantity") as string) || 1;
    const dateStr = formData.get("date") as string;
    const timeSlot = formData.get("timeSlot") as string;
    const notes = (formData.get("notes") as string)?.substring(0, 500) || null;

    if (!productDataStr || !dateStr || !timeSlot) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    try {
      const productData = JSON.parse(productDataStr);
      await prisma.extraBakeOrder.create({
        data: {
          shop,
          date: new Date(dateStr + "T12:00:00"),
          timeSlot,
          shopifyProductId: productData.shopifyProductId,
          productTitle: productData.title,
          variantTitle: productData.variantTitle || null,
          imageUrl: productData.imageUrl || null,
          quantity,
          notes,
        },
      });
      return json({ success: true });
    } catch (error) {
      console.error("Error adding extra bake order:", error);
      return json({ error: "Failed to add extra order" }, { status: 500 });
    }
  }

  if (intent === "remove_extra_order") {
    const orderId = formData.get("orderId") as string;
    if (!orderId) {
      return json({ error: "Missing order ID" }, { status: 400 });
    }

    try {
      await prisma.extraBakeOrder.delete({
        where: { id: orderId },
      });
      return json({ success: true });
    } catch (error) {
      console.error("Error removing extra bake order:", error);
      return json({ error: "Failed to remove extra order" }, { status: 500 });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

// ============================================
// MAIN COMPONENT
// ============================================
export default function CalendarPage() {
  const {
    view,
    year,
    month,
    day,
    weekStart,
    pickupsByDate,
    extraOrdersByDate,
    blackoutDates,
    prepSummaries,
    timeSlots,
    pickupStats,
  } = useLoaderData<LoaderData>();

  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = navigation.state === "submitting";

  // View tabs
  const viewTabs = [
    { id: "month", content: "Monthly" },
    { id: "week", content: "Weekly" },
    { id: "day", content: "Daily" },
  ];
  const selectedViewIndex = viewTabs.findIndex((t) => t.id === view);

  const handleViewChange = useCallback(
    (index: number) => {
      const newView = viewTabs[index].id;
      const params = new URLSearchParams(searchParams);
      params.set("view", newView);
      if (newView === "week") {
        params.set("weekStart", weekStart);
      }
      setSearchParams(params);
    },
    [searchParams, setSearchParams, weekStart]
  );

  // ============================================
  // BLACKOUT CHECK
  // ============================================
  const isBlackedOut = useCallback(
    (checkDate: Date) => {
      const ds = dateKey(checkDate);
      const dow = checkDate.getDay();
      return blackoutDates.some((blackout) => {
        if (blackout.isRecurring && blackout.dayOfWeek === dow) return true;
        if (blackout.date) {
          const bds = blackout.date.split("T")[0];
          if (blackout.dateEnd) {
            const eds = blackout.dateEnd.split("T")[0];
            return ds >= bds && ds <= eds;
          }
          return bds === ds;
        }
        return false;
      });
    },
    [blackoutDates]
  );

  // ============================================
  // NAVIGATION HANDLERS
  // ============================================
  const navigateMonth = useCallback(
    (direction: number) => {
      let newMonth = month + direction;
      let newYear = year;
      if (newMonth < 0) { newMonth = 11; newYear -= 1; }
      else if (newMonth > 11) { newMonth = 0; newYear += 1; }
      const params = new URLSearchParams();
      params.set("view", "month");
      params.set("year", newYear.toString());
      params.set("month", newMonth.toString());
      setSearchParams(params);
    },
    [month, year, setSearchParams]
  );

  const navigateWeek = useCallback(
    (direction: number) => {
      const current = new Date(weekStart + "T12:00:00");
      const newStart = addDays(current, direction * 7);
      const params = new URLSearchParams();
      params.set("view", "week");
      params.set("weekStart", dateKey(newStart));
      params.set("year", newStart.getFullYear().toString());
      params.set("month", newStart.getMonth().toString());
      setSearchParams(params);
    },
    [weekStart, setSearchParams]
  );

  const navigateDay = useCallback(
    (direction: number) => {
      const current = parseLocalDate(year, month, day);
      const newDate = addDays(current, direction);
      const params = new URLSearchParams();
      params.set("view", "day");
      params.set("year", newDate.getFullYear().toString());
      params.set("month", newDate.getMonth().toString());
      params.set("day", newDate.getDate().toString());
      setSearchParams(params);
    },
    [year, month, day, setSearchParams]
  );

  const goToDay = useCallback(
    (targetDate: Date) => {
      const params = new URLSearchParams();
      params.set("view", "day");
      params.set("year", targetDate.getFullYear().toString());
      params.set("month", targetDate.getMonth().toString());
      params.set("day", targetDate.getDate().toString());
      setSearchParams(params);
    },
    [setSearchParams]
  );

  // ============================================
  // RENDER
  // ============================================
  return (
    <Page>
      <TitleBar title="Prep, Bake & Pick-up Calendar" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* View Selector Tabs */}
            <Tabs tabs={viewTabs} selected={selectedViewIndex} onSelect={handleViewChange} />

            {/* View Content */}
            {view === "month" && (
              <MonthView
                year={year}
                month={month}
                pickupsByDate={pickupsByDate}
                extraOrdersByDate={extraOrdersByDate}
                prepSummaries={prepSummaries}
                pickupStats={pickupStats}
                isBlackedOut={isBlackedOut}
                navigateMonth={navigateMonth}
                goToDay={goToDay}
              />
            )}
            {view === "week" && (
              <WeekView
                weekStart={weekStart}
                pickupsByDate={pickupsByDate}
                extraOrdersByDate={extraOrdersByDate}
                prepSummaries={prepSummaries}
                isBlackedOut={isBlackedOut}
                navigateWeek={navigateWeek}
                goToDay={goToDay}
              />
            )}
            {view === "day" && (
              <DayView
                year={year}
                month={month}
                day={day}
                pickupsByDate={pickupsByDate}
                extraOrdersByDate={extraOrdersByDate}
                prepSummaries={prepSummaries}
                timeSlots={timeSlots}
                isBlackedOut={isBlackedOut}
                navigateDay={navigateDay}
                submit={submit}
                shopify={shopify}
                isSubmitting={isSubmitting}
              />
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ============================================
// DAY HEADER BADGE COMPONENT
// ============================================
function DayHeaderBadge({ dayOfWeek, size = "small" }: { dayOfWeek: number; size?: "small" | "medium" }) {
  const header = DAY_HEADERS[dayOfWeek];
  if (!header) return null;
  return (
    <Badge tone={header.tone as any} size={size}>
      {header.label}
    </Badge>
  );
}

// ============================================
// DOUGH PREP SUMMARY COMPONENT
// ============================================
function DoughPrepSummary({
  prepDate,
  items,
  compact = false,
}: {
  prepDate: Date;
  items: PrepSummaryItem[];
  compact?: boolean;
}) {
  const dow = prepDate.getDay();
  const bakeDays = PREP_TO_BAKE_DAYS[dow];
  if (!bakeDays || items.length === 0) return null;

  const bakeDayNames = bakeDays.map((d) => DAY_NAMES_SHORT[d]).join(" + ");
  const totalItems = items.reduce((sum, i) => sum + i.totalQty, 0);

  if (compact) {
    return (
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" fontWeight="semibold" tone="caution">
          Prep for {bakeDayNames}:
        </Text>
        {items.slice(0, 3).map((item) => (
          <Text as="p" variant="bodySm" key={item.productTitle}>
            {item.productTitle} × {item.totalQty}
          </Text>
        ))}
        {items.length > 3 && (
          <Text as="p" variant="bodySm" tone="subdued">
            +{items.length - 3} more...
          </Text>
        )}
      </BlockStack>
    );
  }

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            🍞 Bake Prep Summary ({bakeDayNames})
          </Text>
          <Badge tone="info">{`${totalItems} total items`}</Badge>
        </InlineStack>
        <Divider />
        <BlockStack gap="100">
          {items.map((item) => (
            <InlineStack key={item.productTitle} align="space-between">
              <Text as="p" variant="bodyMd">
                {item.productTitle}
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="bold">
                × {item.totalQty}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

// ============================================
// MONTH VIEW
// ============================================
function MonthView({
  year,
  month,
  pickupsByDate,
  extraOrdersByDate,
  prepSummaries,
  pickupStats,
  isBlackedOut,
  navigateMonth,
  goToDay,
}: {
  year: number;
  month: number;
  pickupsByDate: Record<string, PickupData[]>;
  extraOrdersByDate: Record<string, ExtraBakeOrderData[]>;
  prepSummaries: Record<string, PrepSummaryItem[]>;
  pickupStats: LoaderData["pickupStats"];
  isBlackedOut: (d: Date) => boolean;
  navigateMonth: (dir: number) => void;
  goToDay: (d: Date) => void;
}) {
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const startingDay = firstDayOfMonth.getDay();
  const totalDays = lastDayOfMonth.getDate();

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < startingDay; i++) calendarDays.push(null);
  for (let d = 1; d <= totalDays; d++) calendarDays.push(d);

  const today = new Date();
  const isToday = (d: number) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  return (
    <BlockStack gap="400">
      {/* Month Navigation */}
      <Card>
        <InlineStack align="space-between" blockAlign="center">
          <Button onClick={() => navigateMonth(-1)}>&larr; Previous</Button>
          <Text as="h2" variant="headingLg">
            {MONTH_NAMES[month]} {year}
          </Text>
          <Button onClick={() => navigateMonth(1)}>Next &rarr;</Button>
        </InlineStack>
      </Card>

      {/* Day of Week Headers */}
      <InlineGrid columns={7} gap="200">
        {DAY_NAMES_SHORT.map((dn) => (
          <Box key={dn} padding="200">
            <Text as="p" variant="headingSm" alignment="center">
              {dn}
            </Text>
          </Box>
        ))}
      </InlineGrid>

      {/* Calendar Grid */}
      <InlineGrid columns={7} gap="200">
        {calendarDays.map((dayNum, index) => {
          if (dayNum === null) {
            return (
              <Box
                key={`empty-${index}`}
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
                minHeight="100px"
              />
            );
          }

          const cellDate = parseLocalDate(year, month, dayNum);
          const dk = dateKey(cellDate);
          const dow = cellDate.getDay();
          const dayPickups = pickupsByDate[dk] || [];
          const dayExtras = extraOrdersByDate[dk] || [];
          const prepItems = prepSummaries[dk];
          const blacked = isBlackedOut(cellDate);
          const todayHighlight = isToday(dayNum);

          return (
            <Box
              key={dayNum}
              padding="300"
              background={
                blacked
                  ? "bg-surface-critical"
                  : todayHighlight
                  ? "bg-surface-success"
                  : "bg-surface"
              }
              borderRadius="200"
              borderWidth="025"
              borderColor={todayHighlight ? "border-success" : "border"}
              minHeight="100px"
            >
              <div
                style={{ cursor: "pointer", minHeight: "80px" }}
                onClick={() => goToDay(cellDate)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && goToDay(cellDate)}
              >
                <BlockStack gap="100">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text
                      as="span"
                      variant="bodySm"
                      fontWeight={todayHighlight ? "bold" : "regular"}
                    >
                      {dayNum}
                    </Text>
                    <DayHeaderBadge dayOfWeek={dow} />
                  </InlineStack>

                  {blacked && (
                    <Badge tone="critical" size="small">Closed</Badge>
                  )}

                  {dayPickups.length > 0 && (
                    <Badge tone="info" size="small">
                      {`${dayPickups.length} pickup${dayPickups.length !== 1 ? "s" : ""}`}
                    </Badge>
                  )}

                  {dayExtras.length > 0 && (
                    <Badge tone="attention" size="small">
                      {`+${dayExtras.length} extra`}
                    </Badge>
                  )}

                  {prepItems && (
                    <DoughPrepSummary prepDate={cellDate} items={prepItems} compact />
                  )}
                </BlockStack>
              </div>
            </Box>
          );
        })}
      </InlineGrid>

      {/* Month Summary */}
      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">Month Summary</Text>
          <InlineStack gap="400" wrap>
            <Text as="span" variant="bodySm">
              Total: <strong>{pickupStats.total}</strong>
            </Text>
            <Text as="span" variant="bodySm">
              Scheduled: <strong>{pickupStats.scheduled}</strong>
            </Text>
            <Text as="span" variant="bodySm">
              Ready: <strong>{pickupStats.ready}</strong>
            </Text>
            <Text as="span" variant="bodySm">
              Picked Up: <strong>{pickupStats.pickedUp}</strong>
            </Text>
            {pickupStats.fromPausedSubs > 0 && (
              <Text as="span" variant="bodySm" tone="caution">
                From Paused Subs: <strong>{pickupStats.fromPausedSubs}</strong>
              </Text>
            )}
          </InlineStack>
        </BlockStack>
      </Card>

      {/* Legend */}
      <InlineStack gap="400" wrap>
        <InlineStack gap="100" blockAlign="center">
          <Badge tone="warning" size="small">Dough Prep Day</Badge>
        </InlineStack>
        <InlineStack gap="100" blockAlign="center">
          <Badge tone="success" size="small">Bake Day</Badge>
        </InlineStack>
        <InlineStack gap="100" blockAlign="center">
          <Badge tone="read-only" size="small">Day Off</Badge>
        </InlineStack>
        <InlineStack gap="100" blockAlign="center">
          <Badge tone="info" size="small">Pickups</Badge>
        </InlineStack>
        <InlineStack gap="100" blockAlign="center">
          <Badge tone="attention" size="small">Extra Orders</Badge>
        </InlineStack>
        <InlineStack gap="100" blockAlign="center">
          <Badge tone="critical" size="small">Closed</Badge>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}

// ============================================
// WEEK VIEW
// ============================================
function WeekView({
  weekStart,
  pickupsByDate,
  extraOrdersByDate,
  prepSummaries,
  isBlackedOut,
  navigateWeek,
  goToDay,
}: {
  weekStart: string;
  pickupsByDate: Record<string, PickupData[]>;
  extraOrdersByDate: Record<string, ExtraBakeOrderData[]>;
  prepSummaries: Record<string, PrepSummaryItem[]>;
  isBlackedOut: (d: Date) => boolean;
  navigateWeek: (dir: number) => void;
  goToDay: (d: Date) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const monday = new Date(weekStart + "T12:00:00");
  const sunday = addDays(monday, 6);

  const weekTitle = `Week of ${formatDateShort(monday)} – ${formatDateShort(sunday)}, ${sunday.getFullYear()}`;

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(addDays(monday, i));
  }

  const today = new Date();
  const todayKey = dateKey(today);

  return (
    <BlockStack gap="400">
      {/* Week Navigation */}
      <Card>
        <InlineStack align="space-between" blockAlign="center">
          <Button onClick={() => navigateWeek(-1)}>&larr; Previous Week</Button>
          <Text as="h2" variant="headingLg">{weekTitle}</Text>
          <Button onClick={() => navigateWeek(1)}>Next Week &rarr;</Button>
        </InlineStack>
      </Card>

      {/* Toggle */}
      <InlineStack align="end">
        <Button onClick={() => setExpanded(!expanded)} size="slim">
          {expanded ? "Show Summary" : "Show Details"}
        </Button>
      </InlineStack>

      {/* Day Columns */}
      <InlineGrid columns={{ xs: 1, sm: 2, md: 4, lg: 7 }} gap="300">
        {days.map((d) => {
          const dk = dateKey(d);
          const dow = d.getDay();
          const dayPickups = pickupsByDate[dk] || [];
          const dayExtras = extraOrdersByDate[dk] || [];
          const prepItems = prepSummaries[dk];
          const blacked = isBlackedOut(d);
          const isTodayCell = dk === todayKey;

          // Aggregate products for condensed view
          const productSummary = new Map<string, number>();
          dayPickups.forEach((p) =>
            p.orderItems.forEach((item) => {
              const key = item.variantTitle
                ? `${item.productTitle} (${item.variantTitle})`
                : item.productTitle;
              productSummary.set(key, (productSummary.get(key) || 0) + item.quantity);
            })
          );
          dayExtras.forEach((e) => {
            const key = e.variantTitle
              ? `${e.productTitle} (${e.variantTitle})`
              : e.productTitle;
            productSummary.set(key, (productSummary.get(key) || 0) + e.quantity);
          });

          return (
            <Card key={dk}>
              <BlockStack gap="200">
                {/* Day Header */}
                <div
                  style={{ cursor: "pointer" }}
                  onClick={() => goToDay(d)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && goToDay(d)}
                >
                  <BlockStack gap="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text
                        as="h3"
                        variant="headingSm"
                        fontWeight={isTodayCell ? "bold" : "regular"}
                      >
                        {DAY_NAMES_SHORT[dow]} {d.getDate()}
                      </Text>
                      {isTodayCell && (
                        <Badge tone="success" size="small">Today</Badge>
                      )}
                    </InlineStack>
                    <DayHeaderBadge dayOfWeek={dow} />
                  </BlockStack>
                </div>

                <Divider />

                {blacked && (
                  <Badge tone="critical">Closed</Badge>
                )}

                {!blacked && (
                  <BlockStack gap="200">
                    {/* Pickup count */}
                    {dayPickups.length > 0 && (
                      <Badge tone="info">
                        {`${dayPickups.length} pickup${dayPickups.length !== 1 ? "s" : ""}`}
                      </Badge>
                    )}

                    {dayExtras.length > 0 && (
                      <Badge tone="attention">
                        {`+${dayExtras.length} extra order${dayExtras.length !== 1 ? "s" : ""}`}
                      </Badge>
                    )}

                    {dayPickups.length === 0 && dayExtras.length === 0 && !prepItems && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        No orders
                      </Text>
                    )}

                    {/* Product summary (condensed) or full detail (expanded) */}
                    {!expanded && productSummary.size > 0 && (
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" fontWeight="semibold">Products:</Text>
                        {Array.from(productSummary.entries()).map(([name, qty]) => (
                          <Text as="p" variant="bodySm" key={name}>
                            {name} × {qty}
                          </Text>
                        ))}
                      </BlockStack>
                    )}

                    {expanded && dayPickups.length > 0 && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">Pickups:</Text>
                        {dayPickups.map((pickup) => (
                          <Box key={pickup.id} padding="100" background="bg-surface-secondary" borderRadius="100">
                            <BlockStack gap="050">
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodySm" fontWeight="bold">
                                  {pickup.shopifyOrderNumber}
                                </Text>
                                <Badge tone={statusTone(pickup.pickupStatus)} size="small">
                                  {pickup.pickupStatus}
                                </Badge>
                              </InlineStack>
                              <Text as="p" variant="bodySm">{pickup.customerName}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {pickup.pickupTimeSlot}
                              </Text>
                              {pickup.orderItems.map((item) => (
                                <Text as="p" variant="bodySm" key={item.id}>
                                  &bull; {item.productTitle}
                                  {item.variantTitle ? ` (${item.variantTitle})` : ""} × {item.quantity}
                                </Text>
                              ))}
                            </BlockStack>
                          </Box>
                        ))}
                      </BlockStack>
                    )}

                    {expanded && dayExtras.length > 0 && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">Extra Orders:</Text>
                        {dayExtras.map((extra) => (
                          <Box key={extra.id} padding="100" background="bg-surface-warning" borderRadius="100">
                            <Text as="p" variant="bodySm">
                              {extra.productTitle}
                              {extra.variantTitle ? ` (${extra.variantTitle})` : ""} × {extra.quantity}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">{extra.timeSlot}</Text>
                          </Box>
                        ))}
                      </BlockStack>
                    )}

                    {/* Dough Prep Summary */}
                    {prepItems && (
                      <>
                        <Divider />
                        <DoughPrepSummary prepDate={d} items={prepItems} compact />
                      </>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          );
        })}
      </InlineGrid>
    </BlockStack>
  );
}

// ============================================
// DAY VIEW
// ============================================
function DayView({
  year,
  month,
  day,
  pickupsByDate,
  extraOrdersByDate,
  prepSummaries,
  timeSlots,
  isBlackedOut,
  navigateDay,
  submit,
  shopify,
  isSubmitting,
}: {
  year: number;
  month: number;
  day: number;
  pickupsByDate: Record<string, PickupData[]>;
  extraOrdersByDate: Record<string, ExtraBakeOrderData[]>;
  prepSummaries: Record<string, PrepSummaryItem[]>;
  timeSlots: TimeSlotData[];
  isBlackedOut: (d: Date) => boolean;
  navigateDay: (dir: number) => void;
  submit: ReturnType<typeof useSubmit>;
  shopify: ReturnType<typeof useAppBridge>;
  isSubmitting: boolean;
}) {
  const currentDate = parseLocalDate(year, month, day);
  const dk = dateKey(currentDate);
  const dow = currentDate.getDay();
  const dayPickups = pickupsByDate[dk] || [];
  const dayExtras = extraOrdersByDate[dk] || [];
  const prepItems = prepSummaries[dk];
  const blacked = isBlackedOut(currentDate);
  const header = DAY_HEADERS[dow];

  // Group pickups by time slot
  const pickupsBySlot = useMemo(() => {
    const groups = new Map<string, PickupData[]>();
    dayPickups.forEach((pickup) => {
      const slot = pickup.pickupTimeSlot || "Unscheduled";
      if (!groups.has(slot)) groups.set(slot, []);
      groups.get(slot)!.push(pickup);
    });
    return groups;
  }, [dayPickups]);

  // Extra bake order form state
  const [selectedProduct, setSelectedProduct] = useState<{
    shopifyProductId: string;
    title: string;
    variantTitle?: string;
    imageUrl?: string;
  } | null>(null);
  const [extraQty, setExtraQty] = useState("1");
  const [extraTimeSlot, setExtraTimeSlot] = useState(timeSlots.length > 0 ? timeSlots[0].label : "All Day");
  const [extraNotes, setExtraNotes] = useState("");

  const handlePickProduct = useCallback(async () => {
    try {
      const selected = await (shopify as any).resourcePicker({
        type: "product",
        multiple: false,
        filter: { variants: false },
      });
      if (selected && selected.length > 0) {
        const p = selected[0] as {
          id: string;
          title: string;
          images?: Array<{ originalSrc?: string }>;
        };
        setSelectedProduct({
          shopifyProductId: p.id,
          title: p.title,
          imageUrl: p.images?.[0]?.originalSrc || undefined,
        });
      }
    } catch (err) {
      console.error("Resource picker error:", err);
    }
  }, [shopify]);

  const handleAddExtraOrder = useCallback(() => {
    if (!selectedProduct) return;
    const formData = new FormData();
    formData.set("_action", "add_extra_order");
    formData.set("productData", JSON.stringify(selectedProduct));
    formData.set("quantity", extraQty);
    formData.set("date", dk);
    formData.set("timeSlot", extraTimeSlot);
    if (extraNotes) formData.set("notes", extraNotes);
    submit(formData, { method: "post" });
    // Reset form
    setSelectedProduct(null);
    setExtraQty("1");
    setExtraNotes("");
  }, [selectedProduct, extraQty, extraTimeSlot, extraNotes, dk, submit]);

  const handleRemoveExtraOrder = useCallback(
    (orderId: string) => {
      const formData = new FormData();
      formData.set("_action", "remove_extra_order");
      formData.set("orderId", orderId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const timeSlotOptions = [
    { label: "All Day", value: "All Day" },
    ...timeSlots.map((ts) => ({ label: ts.label, value: ts.label })),
  ];

  const dateTitle = `${formatDateLong(currentDate)} — ${header?.label || ""}`;

  return (
    <BlockStack gap="400">
      {/* Day Navigation */}
      <Card>
        <InlineStack align="space-between" blockAlign="center">
          <Button onClick={() => navigateDay(-1)}>&larr; Previous Day</Button>
          <BlockStack gap="100" inlineAlign="center">
            <Text as="h2" variant="headingLg">
              {formatDateLong(currentDate)}
            </Text>
            <DayHeaderBadge dayOfWeek={dow} size="medium" />
          </BlockStack>
          <Button onClick={() => navigateDay(1)}>Next Day &rarr;</Button>
        </InlineStack>
      </Card>

      {blacked && (
        <Banner tone="critical">
          This day is blacked out / closed.
        </Banner>
      )}

      {/* Dough Prep Summary (prominent on prep days) */}
      {prepItems && (
        <DoughPrepSummary prepDate={currentDate} items={prepItems} />
      )}

      {/* Pickups Section */}
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">
              Pickups ({dayPickups.length})
            </Text>
          </InlineStack>

          {dayPickups.length === 0 ? (
            <Text as="p" variant="bodyMd" tone="subdued">
              No pickups scheduled for this day.
            </Text>
          ) : (
            <BlockStack gap="400">
              {Array.from(pickupsBySlot.entries()).map(([slot, slotPickups]) => (
                <BlockStack key={slot} gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h4" variant="headingSm">
                      {slot}
                    </Text>
                    <Badge tone="info" size="small">
                      {`${slotPickups.length} order${slotPickups.length !== 1 ? "s" : ""}`}
                    </Badge>
                  </InlineStack>
                  <Divider />
                  {slotPickups.map((pickup) => (
                    <Box
                      key={pickup.id}
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center" wrap>
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {pickup.shopifyOrderNumber}
                            </Text>
                            <Badge tone={statusTone(pickup.pickupStatus)}>
                              {pickup.pickupStatus}
                            </Badge>
                            {pickup.subscriptionPickup && (
                              <Badge tone="info" size="small">Subscription</Badge>
                            )}
                          </InlineStack>
                          <Text as="span" variant="bodyMd">
                            {pickup.customerName}
                          </Text>
                        </InlineStack>

                        {/* Product list */}
                        {pickup.orderItems.length > 0 && (
                          <BlockStack gap="050">
                            {pickup.orderItems.map((item) => (
                              <InlineStack key={item.id} gap="200">
                                <Text as="span" variant="bodySm">
                                  &bull; {item.productTitle}
                                  {item.variantTitle ? ` (${item.variantTitle})` : ""}
                                </Text>
                                <Text as="span" variant="bodySm" fontWeight="bold">
                                  × {item.quantity}
                                </Text>
                              </InlineStack>
                            ))}
                          </BlockStack>
                        )}

                        {pickup.notes && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Note: {pickup.notes}
                          </Text>
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      {/* Extra Bake Orders Section */}
      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingMd">
            Extra Bake Orders ({dayExtras.length})
          </Text>

          {dayExtras.length > 0 && (
            <BlockStack gap="200">
              {dayExtras.map((extra) => (
                <Box
                  key={extra.id}
                  padding="300"
                  background="bg-surface-warning"
                  borderRadius="200"
                >
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          {extra.productTitle}
                          {extra.variantTitle ? ` (${extra.variantTitle})` : ""}
                        </Text>
                        <Text as="span" variant="bodyMd">
                          × {extra.quantity}
                        </Text>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Time slot: {extra.timeSlot}
                      </Text>
                      {extra.notes && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Note: {extra.notes}
                        </Text>
                      )}
                    </BlockStack>
                    <Button
                      tone="critical"
                      size="slim"
                      onClick={() => handleRemoveExtraOrder(extra.id)}
                      disabled={isSubmitting}
                    >
                      Remove
                    </Button>
                  </InlineStack>
                </Box>
              ))}
            </BlockStack>
          )}

          <Divider />

          {/* Add Extra Bake Order Form */}
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              Add Extra Bake Order
            </Text>

            <InlineStack gap="300" blockAlign="end" wrap>
              <Box minWidth="200px">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm">Product</Text>
                  <Button onClick={handlePickProduct} size="slim">
                    {selectedProduct ? selectedProduct.title : "Select Product..."}
                  </Button>
                </BlockStack>
              </Box>

              <Box width="100px">
                <TextField
                  label="Quantity"
                  type="number"
                  value={extraQty}
                  onChange={setExtraQty}
                  min={1}
                  autoComplete="off"
                />
              </Box>

              <Box minWidth="180px">
                <Select
                  label="Time Slot"
                  options={timeSlotOptions}
                  value={extraTimeSlot}
                  onChange={setExtraTimeSlot}
                />
              </Box>

              <Box minWidth="150px">
                <TextField
                  label="Notes (optional)"
                  value={extraNotes}
                  onChange={setExtraNotes}
                  autoComplete="off"
                />
              </Box>

              <Button
                variant="primary"
                onClick={handleAddExtraOrder}
                disabled={!selectedProduct || isSubmitting}
                loading={isSubmitting}
              >
                Add
              </Button>
            </InlineStack>
          </BlockStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
