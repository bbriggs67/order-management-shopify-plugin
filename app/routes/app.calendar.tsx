import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const monthParam = url.searchParams.get("month");

  const now = new Date();
  const year = yearParam ? parseInt(yearParam) : now.getFullYear();
  const month = monthParam ? parseInt(monthParam) : now.getMonth();

  // Get first and last day of the month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Get pickups for the month
  const pickups = await prisma.pickupSchedule.findMany({
    where: {
      shop,
      pickupDate: {
        gte: firstDay,
        lte: lastDay,
      },
    },
    orderBy: { pickupDate: "asc" },
  });

  // Get blackout dates for the month
  const blackoutDates = await prisma.blackoutDate.findMany({
    where: {
      shop,
      isActive: true,
      OR: [
        {
          date: {
            gte: firstDay,
            lte: lastDay,
          },
        },
        {
          isRecurring: true,
        },
      ],
    },
  });

  // Group pickups by date
  const pickupsByDate: Record<string, typeof pickups> = {};
  pickups.forEach((pickup) => {
    const dateKey = new Date(pickup.pickupDate).toISOString().split("T")[0];
    if (!pickupsByDate[dateKey]) {
      pickupsByDate[dateKey] = [];
    }
    pickupsByDate[dateKey].push(pickup);
  });

  return json({
    year,
    month,
    pickupsByDate,
    blackoutDates,
  });
};

export default function CalendarPage() {
  const { year, month, pickupsByDate, blackoutDates } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const navigateMonth = (direction: number) => {
    let newMonth = month + direction;
    let newYear = year;

    if (newMonth < 0) {
      newMonth = 11;
      newYear -= 1;
    } else if (newMonth > 11) {
      newMonth = 0;
      newYear += 1;
    }

    const params = new URLSearchParams();
    params.set("year", newYear.toString());
    params.set("month", newMonth.toString());
    setSearchParams(params);
  };

  // Build calendar grid
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const startingDay = firstDayOfMonth.getDay();
  const totalDays = lastDayOfMonth.getDate();

  const calendarDays: (number | null)[] = [];

  // Add empty cells for days before the first of the month
  for (let i = 0; i < startingDay; i++) {
    calendarDays.push(null);
  }

  // Add days of the month
  for (let day = 1; day <= totalDays; day++) {
    calendarDays.push(day);
  }

  // Check if a date is blacked out
  const isBlackedOut = (day: number) => {
    const date = new Date(year, month, day);
    const dateStr = date.toISOString().split("T")[0];
    const dayOfWeek = date.getDay();

    return blackoutDates.some((blackout) => {
      if (blackout.isRecurring && blackout.dayOfWeek === dayOfWeek) {
        return true;
      }
      if (blackout.date) {
        const blackoutDateStr = new Date(blackout.date)
          .toISOString()
          .split("T")[0];
        if (blackout.dateEnd) {
          const endDateStr = new Date(blackout.dateEnd)
            .toISOString()
            .split("T")[0];
          return dateStr >= blackoutDateStr && dateStr <= endDateStr;
        }
        return blackoutDateStr === dateStr;
      }
      return false;
    });
  };

  const getPickupsForDay = (day: number) => {
    const dateStr = new Date(year, month, day).toISOString().split("T")[0];
    return pickupsByDate[dateStr] || [];
  };

  const today = new Date();
  const isToday = (day: number) => {
    return (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    );
  };

  return (
    <Page>
      <TitleBar title="Pickup Calendar" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {/* Month Navigation */}
              <InlineStack align="space-between" blockAlign="center">
                <Button onClick={() => navigateMonth(-1)}>&larr; Previous</Button>
                <Text as="h2" variant="headingLg">
                  {monthNames[month]} {year}
                </Text>
                <Button onClick={() => navigateMonth(1)}>Next &rarr;</Button>
              </InlineStack>

              {/* Day Headers */}
              <InlineGrid columns={7} gap="200">
                {dayNames.map((day) => (
                  <Box key={day} padding="200">
                    <Text as="p" variant="headingSm" alignment="center">
                      {day}
                    </Text>
                  </Box>
                ))}
              </InlineGrid>

              {/* Calendar Grid */}
              <InlineGrid columns={7} gap="200">
                {calendarDays.map((day, index) => {
                  if (day === null) {
                    return (
                      <Box
                        key={`empty-${index}`}
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                        minHeight="80px"
                      />
                    );
                  }

                  const dayPickups = getPickupsForDay(day);
                  const blacked = isBlackedOut(day);
                  const todayStyle = isToday(day);

                  return (
                    <Box
                      key={day}
                      padding="300"
                      background={
                        blacked
                          ? "bg-surface-critical-subdued"
                          : todayStyle
                          ? "bg-surface-success-subdued"
                          : "bg-surface"
                      }
                      borderRadius="200"
                      borderWidth="025"
                      borderColor={todayStyle ? "border-success" : "border"}
                      minHeight="80px"
                    >
                      <BlockStack gap="100">
                        <InlineStack align="space-between">
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight={todayStyle ? "bold" : "regular"}
                          >
                            {day}
                          </Text>
                          {blacked && (
                            <Badge tone="critical" size="small">
                              Closed
                            </Badge>
                          )}
                        </InlineStack>
                        {dayPickups.length > 0 && (
                          <Badge tone="info">{dayPickups.length} pickups</Badge>
                        )}
                      </BlockStack>
                    </Box>
                  );
                })}
              </InlineGrid>

              {/* Legend */}
              <InlineStack gap="400">
                <InlineStack gap="100" blockAlign="center">
                  <Box
                    background="bg-surface-critical-subdued"
                    padding="100"
                    borderRadius="100"
                  >
                    <Text as="span" variant="bodySm">
                      &nbsp;&nbsp;
                    </Text>
                  </Box>
                  <Text as="span" variant="bodySm">
                    Closed/Blackout
                  </Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <Box
                    background="bg-surface-success-subdued"
                    padding="100"
                    borderRadius="100"
                  >
                    <Text as="span" variant="bodySm">
                      &nbsp;&nbsp;
                    </Text>
                  </Box>
                  <Text as="span" variant="bodySm">
                    Today
                  </Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <Badge tone="info" size="small">
                    N
                  </Badge>
                  <Text as="span" variant="bodySm">
                    Number of pickups
                  </Text>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
