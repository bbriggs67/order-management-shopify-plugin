import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  EmptyState,
  DataTable,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendReadyNotification } from "../services/notifications.server";
import { getTodayBoundariesUTC } from "../utils/timezone.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get today's boundaries in Pacific timezone (converted to UTC for DB query)
  const { start: today, end: todayEnd } = getTodayBoundariesUTC();
  const tomorrow = new Date(todayEnd);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // Get today's pickups (using Pacific timezone boundaries)
  const todaysPickups = await prisma.pickupSchedule.findMany({
    where: {
      shop,
      pickupDate: {
        gte: today,
        lte: todayEnd,
      },
    },
    orderBy: { pickupTimeSlot: "asc" },
    take: 20,
  });

  // Get counts
  const todayCount = todaysPickups.length;
  const scheduledCount = todaysPickups.filter((p) => p.pickupStatus === "SCHEDULED").length;
  const readyCount = todaysPickups.filter((p) => p.pickupStatus === "READY").length;
  const pickedUpCount = todaysPickups.filter((p) => p.pickupStatus === "PICKED_UP").length;

  const weekCount = await prisma.pickupSchedule.count({
    where: {
      shop,
      pickupDate: {
        gte: today,
        lt: weekEnd,
      },
    },
  });

  const activeSubscriptions = await prisma.subscriptionPickup.count({
    where: {
      shop,
      status: "ACTIVE",
    },
  });

  return json({
    todaysPickups,
    todayCount,
    scheduledCount,
    readyCount,
    pickedUpCount,
    weekCount,
    activeSubscriptions,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get("_action") as string;
  const orderId = formData.get("orderId") as string;

  if (!orderId) {
    return json({ error: "Order ID required" }, { status: 400 });
  }

  const pickup = await prisma.pickupSchedule.findFirst({
    where: { shop, id: orderId },
  });

  if (!pickup) {
    return json({ error: "Order not found" }, { status: 404 });
  }

  if (action === "markReady") {
    await prisma.pickupSchedule.update({
      where: { id: orderId },
      data: { pickupStatus: "READY" },
    });

    // Send notification
    try {
      await sendReadyNotification(orderId, shop);
    } catch (error) {
      console.error("Failed to send notification:", error);
    }

    return json({ success: true });
  }

  if (action === "markPickedUp") {
    await prisma.pickupSchedule.update({
      where: { id: orderId },
      data: { pickupStatus: "PICKED_UP" },
    });

    return json({ success: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function Dashboard() {
  const {
    todaysPickups,
    todayCount,
    scheduledCount,
    readyCount,
    pickedUpCount,
    weekCount,
    activeSubscriptions,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const handleMarkReady = useCallback(
    (orderId: string) => {
      const formData = new FormData();
      formData.append("_action", "markReady");
      formData.append("orderId", orderId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handleMarkPickedUp = useCallback(
    (orderId: string) => {
      const formData = new FormData();
      formData.append("_action", "markPickedUp");
      formData.append("orderId", orderId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "SCHEDULED":
        return <Badge tone="info">Scheduled</Badge>;
      case "READY":
        return <Badge tone="success">Ready</Badge>;
      case "PICKED_UP":
        return <Badge>Picked Up</Badge>;
      case "CANCELLED":
        return <Badge tone="critical">Cancelled</Badge>;
      case "NO_SHOW":
        return <Badge tone="warning">No Show</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getActionButtons = (pickup: (typeof todaysPickups)[0]) => {
    const buttons = [];

    if (pickup.pickupStatus === "SCHEDULED") {
      buttons.push(
        <Button
          key="ready"
          size="slim"
          variant="primary"
          onClick={() => handleMarkReady(pickup.id)}
          loading={isLoading}
        >
          Mark Ready
        </Button>
      );
    }

    if (pickup.pickupStatus === "READY") {
      buttons.push(
        <Button
          key="pickedup"
          size="slim"
          variant="primary"
          onClick={() => handleMarkPickedUp(pickup.id)}
          loading={isLoading}
        >
          Picked Up
        </Button>
      );
    }

    buttons.push(
      <Button key="view" size="slim" url={`/app/orders/${pickup.id}`}>
        View
      </Button>
    );

    return <InlineStack gap="200">{buttons}</InlineStack>;
  };

  const tableRows = todaysPickups.map((pickup) => [
    pickup.shopifyOrderNumber,
    pickup.customerName,
    pickup.pickupTimeSlot,
    getStatusBadge(pickup.pickupStatus),
    getActionButtons(pickup),
  ]);

  return (
    <Page>
      <TitleBar title="Susie Sourdough Dashboard" />
      <BlockStack gap="500">
        {/* Summary Banner */}
        {todayCount > 0 && (
          <Banner tone="info">
            <Text as="p">
              Today: {scheduledCount} scheduled, {readyCount} ready for pickup, {pickedUpCount} picked
              up
            </Text>
          </Banner>
        )}

        {/* Stats Cards */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Today's Pickups
                </Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="heading2xl" fontWeight="bold">
                    {todayCount}
                  </Text>
                  <BlockStack gap="100">
                    {scheduledCount > 0 && (
                      <Badge tone="info">{scheduledCount} scheduled</Badge>
                    )}
                    {readyCount > 0 && (
                      <Badge tone="success">{readyCount} ready</Badge>
                    )}
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  This Week
                </Text>
                <Text as="p" variant="heading2xl" fontWeight="bold">
                  {weekCount}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Active Subscriptions
                </Text>
                <Text as="p" variant="heading2xl" fontWeight="bold">
                  {activeSubscriptions}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Today's Pickups Table */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingLg">
                    Today's Pickups
                  </Text>
                  <Button url="/app/orders">View All Orders</Button>
                </InlineStack>

                {todaysPickups.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["Order", "Customer", "Time Slot", "Status", "Actions"]}
                    rows={tableRows}
                  />
                ) : (
                  <EmptyState
                    heading="No pickups scheduled for today"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>When customers place orders with pickup dates, they'll appear here.</p>
                  </EmptyState>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Quick Actions */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Quick Actions
                </Text>
                <InlineStack gap="300">
                  <Button url="/app/calendar">View Calendar</Button>
                  <Button url="/app/settings/blackouts">Manage Blackout Dates</Button>
                  <Button url="/app/settings/prep-times">Configure Prep Times</Button>
                  <Button url="/app/settings/notifications">Notification Settings</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
