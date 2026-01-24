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
  Divider,
  Box,
  Banner,
  TextField,
  Modal,
  Select,
  DataTable,
  DescriptionList,
  DatePicker,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getDatePacific,
  getDayOfWeekPacific,
} from "../utils/timezone.server";

// Timezone constant for client-side formatting
const SHOP_TIMEZONE = "America/Los_Angeles";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { contractId } = params;

  if (!contractId) {
    throw new Response("Contract ID required", { status: 400 });
  }

  const subscription = await prisma.subscriptionPickup.findFirst({
    where: {
      shop,
      shopifyContractId: decodeURIComponent(contractId),
    },
    include: {
      pickupSchedules: {
        orderBy: { pickupDate: "desc" },
        take: 10,
        include: {
          pickupLocation: true,
        },
      },
    },
  });

  if (!subscription) {
    throw new Response("Subscription not found", { status: 404 });
  }

  // Get available time slots
  const timeSlots = await prisma.timeSlot.findMany({
    where: { shop, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  // Get pickup day configs (normalized - one row per day)
  const pickupDayConfigs = await prisma.pickupDayConfig.findMany({
    where: { shop },
    orderBy: { dayOfWeek: "asc" },
  });

  return json({
    subscription,
    timeSlots,
    pickupDayConfigs,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { contractId } = params;

  if (!contractId) {
    return json({ error: "Contract ID required" }, { status: 400 });
  }

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  const subscription = await prisma.subscriptionPickup.findFirst({
    where: { shop, shopifyContractId: decodeURIComponent(contractId) },
  });

  if (!subscription) {
    return json({ error: "Subscription not found" }, { status: 404 });
  }

  if (action === "pause") {
    const pauseReason = formData.get("pauseReason") as string;
    const pauseUntilStr = formData.get("pauseUntil") as string;

    const pausedUntil = pauseUntilStr ? new Date(pauseUntilStr) : null;

    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: {
        status: "PAUSED",
        pausedUntil,
        pauseReason: pauseReason || null,
      },
    });

    return json({ success: true, action: "paused" });
  }

  if (action === "resume") {
    // Calculate next pickup date based on preferred day
    const nextPickupDate = calculateNextPickupDate(
      subscription.preferredDay,
      subscription.frequency
    );

    // Billing is 4 days before pickup
    const nextBillingDate = new Date(nextPickupDate);
    nextBillingDate.setDate(nextBillingDate.getDate() - 4);

    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        pausedUntil: null,
        pauseReason: null,
        nextPickupDate,
        nextBillingDate,
      },
    });

    return json({ success: true, action: "resumed" });
  }

  if (action === "cancel") {
    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: {
        status: "CANCELLED",
        nextPickupDate: null,
        nextBillingDate: null,
      },
    });

    // Note: In production, you'd also cancel the Shopify subscription contract
    // via the GraphQL API

    return json({ success: true, action: "cancelled" });
  }

  if (action === "skipNext") {
    // Skip the next pickup by advancing to the following pickup date
    if (!subscription.nextPickupDate) {
      return json({ error: "No next pickup to skip" }, { status: 400 });
    }

    const nextPickupDate = calculateNextPickupDateAfter(
      new Date(subscription.nextPickupDate),
      subscription.preferredDay,
      subscription.frequency
    );

    const nextBillingDate = new Date(nextPickupDate);
    nextBillingDate.setDate(nextBillingDate.getDate() - 4);

    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: {
        nextPickupDate,
        nextBillingDate,
      },
    });

    return json({ success: true, action: "skipped" });
  }

  if (action === "updatePreferences") {
    const preferredDay = parseInt(formData.get("preferredDay") as string, 10);
    const preferredTimeSlot = formData.get("preferredTimeSlot") as string;
    const frequency = formData.get("frequency") as string;

    // Validate
    if (isNaN(preferredDay) || preferredDay < 0 || preferredDay > 6) {
      return json({ error: "Invalid preferred day" }, { status: 400 });
    }

    // Calculate new discount based on frequency
    const discountPercent = frequency === "WEEKLY" ? 10 : 5;

    // Recalculate next pickup date if frequency changed
    const nextPickupDate = calculateNextPickupDate(preferredDay, frequency);
    const nextBillingDate = new Date(nextPickupDate);
    nextBillingDate.setDate(nextBillingDate.getDate() - 4);

    await prisma.subscriptionPickup.update({
      where: { id: subscription.id },
      data: {
        preferredDay,
        preferredTimeSlot,
        frequency,
        discountPercent,
        nextPickupDate,
        nextBillingDate,
      },
    });

    return json({ success: true, action: "updated" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

// Helper: Calculate next pickup date for a given day of week
function calculateNextPickupDate(
  preferredDay: number,
  frequency: string
): Date {
  const today = getDatePacific(0);
  const currentDay = getDayOfWeekPacific(today);

  // Find days until next preferred day
  let daysUntil = preferredDay - currentDay;
  if (daysUntil <= 0) {
    daysUntil += 7;
  }

  // For bi-weekly, ensure we're at least 7 days out for the first pickup
  if (frequency === "BIWEEKLY" && daysUntil < 7) {
    daysUntil += 7;
  }

  const nextDate = getDatePacific(daysUntil);
  return nextDate;
}

// Helper: Calculate next pickup date after a specific date
function calculateNextPickupDateAfter(
  afterDate: Date,
  preferredDay: number,
  frequency: string
): Date {
  const increment = frequency === "WEEKLY" ? 7 : 14;
  const nextDate = new Date(afterDate);
  nextDate.setDate(nextDate.getDate() + increment);

  // Adjust to preferred day if needed
  const nextDay = nextDate.getDay();
  if (nextDay !== preferredDay) {
    const diff = preferredDay - nextDay;
    nextDate.setDate(nextDate.getDate() + diff);
  }

  return nextDate;
}

export default function SubscriptionDetail() {
  const { subscription, timeSlots, pickupDayConfigs } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseUntil, setPauseUntil] = useState<Date | null>(null);
  const [selectedMonth, setSelectedMonth] = useState({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
  });

  // Edit form state
  const [editFrequency, setEditFrequency] = useState(subscription.frequency);
  const [editPreferredDay, setEditPreferredDay] = useState(
    subscription.preferredDay.toString()
  );
  const [editTimeSlot, setEditTimeSlot] = useState(
    subscription.preferredTimeSlot
  );

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      timeZone: SHOP_TIMEZONE,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      timeZone: SHOP_TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { tone: any; label: string }> = {
      ACTIVE: { tone: "success", label: "Active" },
      PAUSED: { tone: "warning", label: "Paused" },
      CANCELLED: { tone: "critical", label: "Cancelled" },
    };
    const config = statusMap[status] || { tone: "info", label: status };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  };

  const getPickupStatusBadge = (status: string) => {
    const statusMap: Record<string, { tone: any; label: string }> = {
      SCHEDULED: { tone: "info", label: "Scheduled" },
      READY: { tone: "success", label: "Ready" },
      PICKED_UP: { tone: "success", label: "Picked Up" },
      CANCELLED: { tone: "critical", label: "Cancelled" },
      NO_SHOW: { tone: "warning", label: "No Show" },
    };
    const config = statusMap[status] || { tone: "info", label: status };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  };

  const getDayName = (dayNum: number) => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[dayNum] || "Unknown";
  };

  const getFrequencyLabel = (frequency: string) => {
    switch (frequency) {
      case "WEEKLY":
        return "Weekly";
      case "BIWEEKLY":
        return "Every 2 weeks";
      default:
        return frequency;
    }
  };

  // Get available pickup days
  const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const getAvailableDays = () => {
    if (!pickupDayConfigs || pickupDayConfigs.length === 0) {
      // Default days: Tue, Wed, Fri, Sat
      return [
        { label: "Tuesday", value: "2" },
        { label: "Wednesday", value: "3" },
        { label: "Friday", value: "5" },
        { label: "Saturday", value: "6" },
      ];
    }

    return pickupDayConfigs
      .filter((config) => config.isEnabled)
      .map((config) => ({
        label: DAY_LABELS[config.dayOfWeek],
        value: config.dayOfWeek.toString(),
      }));
  };

  const handlePause = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "pause");
    formData.append("pauseReason", pauseReason);
    if (pauseUntil) {
      formData.append("pauseUntil", pauseUntil.toISOString());
    }
    submit(formData, { method: "post" });
    setPauseModalOpen(false);
    setPauseReason("");
    setPauseUntil(null);
  }, [pauseReason, pauseUntil, submit]);

  const handleResume = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "resume");
    submit(formData, { method: "post" });
  }, [submit]);

  const handleCancel = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "cancel");
    submit(formData, { method: "post" });
    setCancelModalOpen(false);
  }, [submit]);

  const handleSkipNext = useCallback(() => {
    if (
      confirm(
        "Are you sure you want to skip the next pickup? The customer will not be billed."
      )
    ) {
      const formData = new FormData();
      formData.append("_action", "skipNext");
      submit(formData, { method: "post" });
    }
  }, [submit]);

  const handleUpdatePreferences = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "updatePreferences");
    formData.append("preferredDay", editPreferredDay);
    formData.append("preferredTimeSlot", editTimeSlot);
    formData.append("frequency", editFrequency);
    submit(formData, { method: "post" });
    setEditModalOpen(false);
  }, [editPreferredDay, editTimeSlot, editFrequency, submit]);

  const handleMonthChange = useCallback(
    (month: number, year: number) => setSelectedMonth({ month, year }),
    []
  );

  // Pickup history table
  const historyRows = subscription.pickupSchedules.map((pickup) => [
    formatDate(pickup.pickupDate),
    pickup.pickupTimeSlot,
    pickup.pickupLocation?.name || "Default",
    getPickupStatusBadge(pickup.pickupStatus),
    <Button key={pickup.id} url={`/app/orders/${pickup.id}`} size="slim">
      View
    </Button>,
  ]);

  const isActive = subscription.status === "ACTIVE";
  const isPaused = subscription.status === "PAUSED";
  const isCancelled = subscription.status === "CANCELLED";

  return (
    <Page
      backAction={{ content: "Subscriptions", url: "/app/subscriptions" }}
      title={`Subscription - ${subscription.customerName}`}
      titleMetadata={getStatusBadge(subscription.status)}
    >
      <TitleBar title={`Subscription - ${subscription.customerName}`} />

      <Layout>
        {/* Main Content */}
        <Layout.Section>
          <BlockStack gap="400">
            {/* Status Banner */}
            {isPaused && (
              <Banner tone="warning" title="Subscription Paused">
                {subscription.pausedUntil ? (
                  <p>
                    This subscription is paused until{" "}
                    {formatDate(subscription.pausedUntil.toString())}.
                    {subscription.pauseReason &&
                      ` Reason: ${subscription.pauseReason}`}
                  </p>
                ) : (
                  <p>
                    This subscription is paused indefinitely.
                    {subscription.pauseReason &&
                      ` Reason: ${subscription.pauseReason}`}
                  </p>
                )}
              </Banner>
            )}

            {isCancelled && (
              <Banner tone="critical" title="Subscription Cancelled">
                <p>This subscription has been cancelled.</p>
              </Banner>
            )}

            {/* Actions Card */}
            {!isCancelled && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Actions
                  </Text>
                  <InlineStack gap="300">
                    {isActive && (
                      <>
                        <Button onClick={() => setPauseModalOpen(true)}>
                          Pause Subscription
                        </Button>
                        {subscription.nextPickupDate && (
                          <Button onClick={handleSkipNext} loading={isLoading}>
                            Skip Next Pickup
                          </Button>
                        )}
                      </>
                    )}
                    {isPaused && (
                      <Button
                        variant="primary"
                        onClick={handleResume}
                        loading={isLoading}
                      >
                        Resume Subscription
                      </Button>
                    )}
                    <Button onClick={() => setEditModalOpen(true)}>
                      Edit Preferences
                    </Button>
                    {!isCancelled && (
                      <Button
                        tone="critical"
                        onClick={() => setCancelModalOpen(true)}
                      >
                        Cancel Subscription
                      </Button>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {/* Subscription Details */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Subscription Details
                </Text>
                <DescriptionList
                  items={[
                    {
                      term: "Frequency",
                      description: `${getFrequencyLabel(subscription.frequency)} (${subscription.discountPercent}% discount)`,
                    },
                    {
                      term: "Preferred Day",
                      description: getDayName(subscription.preferredDay),
                    },
                    {
                      term: "Time Slot",
                      description: subscription.preferredTimeSlot,
                    },
                    {
                      term: "Next Pickup",
                      description: formatDate(subscription.nextPickupDate?.toString() || null),
                    },
                    {
                      term: "Next Billing Date",
                      description: formatDate(subscription.nextBillingDate?.toString() || null),
                    },
                  ]}
                />
              </BlockStack>
            </Card>

            {/* Pickup History */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Pickup History
                </Text>
                {subscription.pickupSchedules.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={[
                      "Date",
                      "Time Slot",
                      "Location",
                      "Status",
                      "Actions",
                    ]}
                    rows={historyRows}
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    No pickup history yet.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Sidebar */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Customer Info */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Customer
                </Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {subscription.customerName}
                  </Text>
                  {subscription.customerEmail && (
                    <Text as="p" variant="bodySm">
                      {subscription.customerEmail}
                    </Text>
                  )}
                  {subscription.customerPhone && (
                    <Text as="p" variant="bodySm">
                      {subscription.customerPhone}
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Billing Info */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Billing
                </Text>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">
                      Discount
                    </Text>
                    <Badge tone="success">
                      {subscription.discountPercent}% off
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Customer is billed 4 days before each pickup.
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Timeline */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Timeline
                </Text>
                <BlockStack gap="200">
                  <Box
                    padding="200"
                    background="bg-surface-secondary"
                    borderRadius="100"
                  >
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">
                        Created
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {formatDateTime(subscription.createdAt)}
                      </Text>
                    </InlineStack>
                  </Box>
                  {subscription.updatedAt !== subscription.createdAt && (
                    <Box
                      padding="200"
                      background="bg-surface-secondary"
                      borderRadius="100"
                    >
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm">
                          Last updated
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {formatDateTime(subscription.updatedAt)}
                        </Text>
                      </InlineStack>
                    </Box>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Pause Modal */}
      <Modal
        open={pauseModalOpen}
        onClose={() => setPauseModalOpen(false)}
        title="Pause Subscription"
        primaryAction={{
          content: "Pause",
          onAction: handlePause,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setPauseModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              Pausing the subscription will stop future pickups and billing
              until resumed.
            </Text>
            <TextField
              label="Reason for pause (optional)"
              value={pauseReason}
              onChange={setPauseReason}
              autoComplete="off"
              placeholder="e.g., Going on vacation"
            />
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Resume automatically on (optional):
              </Text>
              <DatePicker
                month={selectedMonth.month}
                year={selectedMonth.year}
                onChange={(range) => setPauseUntil(range.start)}
                onMonthChange={handleMonthChange}
                selected={pauseUntil || undefined}
                disableDatesBefore={new Date()}
              />
              {pauseUntil && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Will auto-resume on {formatDate(pauseUntil.toISOString())}
                </Text>
              )}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Cancel Modal */}
      <Modal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Cancel Subscription"
        primaryAction={{
          content: "Cancel Subscription",
          destructive: true,
          onAction: handleCancel,
        }}
        secondaryActions={[
          {
            content: "Keep Subscription",
            onAction: () => setCancelModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Are you sure you want to cancel this subscription? This action
              cannot be undone.
            </Text>
            <Text as="p" tone="subdued">
              The customer will no longer receive automatic pickups and will
              lose their {subscription.discountPercent}% discount.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Edit Preferences Modal */}
      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit Subscription Preferences"
        primaryAction={{
          content: "Save Changes",
          onAction: handleUpdatePreferences,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setEditModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select
              label="Frequency"
              options={[
                { label: "Weekly (10% discount)", value: "WEEKLY" },
                { label: "Every 2 weeks (5% discount)", value: "BIWEEKLY" },
              ]}
              value={editFrequency}
              onChange={setEditFrequency}
            />
            <Select
              label="Preferred Pickup Day"
              options={getAvailableDays()}
              value={editPreferredDay}
              onChange={setEditPreferredDay}
            />
            <Select
              label="Preferred Time Slot"
              options={timeSlots.map((ts) => ({
                label: ts.label,
                value: ts.label,
              }))}
              value={editTimeSlot}
              onChange={setEditTimeSlot}
            />
            <Banner tone="info">
              Changing these preferences will recalculate the next pickup date.
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
