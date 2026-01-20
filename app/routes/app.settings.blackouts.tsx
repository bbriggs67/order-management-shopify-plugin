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
  TextField,
  Select,
  Button,
  Badge,
  Modal,
  FormLayout,
  DataTable,
  EmptyState,
  Checkbox,
  Divider,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const blackouts = await prisma.blackoutDate.findMany({
    where: { shop },
    orderBy: [{ isRecurring: "asc" }, { date: "asc" }, { dayOfWeek: "asc" }],
  });

  return json({ blackouts });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "create") {
    const type = formData.get("type") as string;
    const reason = formData.get("reason") as string;
    const hasTimeWindow = formData.get("hasTimeWindow") === "true";
    const startTime = hasTimeWindow ? (formData.get("startTime") as string) : null;
    const endTime = hasTimeWindow ? (formData.get("endTime") as string) : null;

    if (type === "single") {
      const date = formData.get("date") as string;
      await prisma.blackoutDate.create({
        data: {
          shop,
          date: new Date(date),
          startTime,
          endTime,
          reason,
          isRecurring: false,
          isActive: true,
        },
      });
    } else if (type === "range") {
      const dateStart = formData.get("dateStart") as string;
      const dateEnd = formData.get("dateEnd") as string;
      await prisma.blackoutDate.create({
        data: {
          shop,
          date: new Date(dateStart),
          dateEnd: new Date(dateEnd),
          startTime,
          endTime,
          reason,
          isRecurring: false,
          isActive: true,
        },
      });
    } else if (type === "recurring") {
      const dayOfWeek = parseInt(formData.get("dayOfWeek") as string);
      await prisma.blackoutDate.create({
        data: {
          shop,
          dayOfWeek,
          startTime,
          endTime,
          reason,
          isRecurring: true,
          isActive: true,
        },
      });
    }
  } else if (action === "toggle") {
    const id = formData.get("id") as string;
    const blackout = await prisma.blackoutDate.findUnique({ where: { id } });
    if (blackout) {
      await prisma.blackoutDate.update({
        where: { id },
        data: { isActive: !blackout.isActive },
      });
    }
  } else if (action === "delete") {
    const id = formData.get("id") as string;
    await prisma.blackoutDate.delete({ where: { id } });
  }

  return json({ success: true });
};

export default function BlackoutsSettings() {
  const { blackouts } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [modalOpen, setModalOpen] = useState(false);
  const [blackoutType, setBlackoutType] = useState("single");
  const [newBlackout, setNewBlackout] = useState({
    date: "",
    dateStart: "",
    dateEnd: "",
    dayOfWeek: "0",
    hasTimeWindow: false,
    startTime: "09:00",
    endTime: "17:00",
    reason: "",
  });

  const dayOptions = [
    { label: "Sunday", value: "0" },
    { label: "Monday", value: "1" },
    { label: "Tuesday", value: "2" },
    { label: "Wednesday", value: "3" },
    { label: "Thursday", value: "4" },
    { label: "Friday", value: "5" },
    { label: "Saturday", value: "6" },
  ];

  const timeOptions = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let min = 0; min < 60; min += 30) {
      const time = `${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
      const displayHour = hour % 12 || 12;
      const ampm = hour < 12 ? "AM" : "PM";
      const label = `${displayHour}:${min.toString().padStart(2, "0")} ${ampm}`;
      timeOptions.push({ label, value: time });
    }
  }

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const displayHour = hour % 12 || 12;
    const ampm = hour < 12 ? "AM" : "PM";
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getDayLabel = (dayOfWeek: number) => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[dayOfWeek];
  };

  const handleCreate = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "create");
    formData.append("type", blackoutType);
    formData.append("reason", newBlackout.reason);
    formData.append("hasTimeWindow", newBlackout.hasTimeWindow.toString());

    if (newBlackout.hasTimeWindow) {
      formData.append("startTime", newBlackout.startTime);
      formData.append("endTime", newBlackout.endTime);
    }

    if (blackoutType === "single") {
      if (!newBlackout.date) return;
      formData.append("date", newBlackout.date);
    } else if (blackoutType === "range") {
      if (!newBlackout.dateStart || !newBlackout.dateEnd) return;
      formData.append("dateStart", newBlackout.dateStart);
      formData.append("dateEnd", newBlackout.dateEnd);
    } else if (blackoutType === "recurring") {
      formData.append("dayOfWeek", newBlackout.dayOfWeek);
    }

    submit(formData, { method: "post" });
    setModalOpen(false);
    setNewBlackout({
      date: "",
      dateStart: "",
      dateEnd: "",
      dayOfWeek: "0",
      hasTimeWindow: false,
      startTime: "09:00",
      endTime: "17:00",
      reason: "",
    });
    setBlackoutType("single");
  }, [blackoutType, newBlackout, submit]);

  const handleToggle = useCallback((id: string) => {
    const formData = new FormData();
    formData.append("_action", "toggle");
    formData.append("id", id);
    submit(formData, { method: "post" });
  }, [submit]);

  const handleDelete = useCallback((id: string) => {
    if (confirm("Are you sure you want to delete this blackout date?")) {
      const formData = new FormData();
      formData.append("_action", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
    }
  }, [submit]);

  const getBlackoutDescription = (blackout: typeof blackouts[0]) => {
    if (blackout.isRecurring && blackout.dayOfWeek !== null) {
      return `Every ${getDayLabel(blackout.dayOfWeek)}`;
    }
    if (blackout.dateEnd) {
      return `${formatDate(blackout.date!)} - ${formatDate(blackout.dateEnd)}`;
    }
    return formatDate(blackout.date!);
  };

  const getTimeDescription = (blackout: typeof blackouts[0]) => {
    if (blackout.startTime && blackout.endTime) {
      return `${formatTime(blackout.startTime)} - ${formatTime(blackout.endTime)}`;
    }
    return "All day";
  };

  const tableRows = blackouts.map((blackout) => [
    <BlockStack key={`desc-${blackout.id}`} gap="100">
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {getBlackoutDescription(blackout)}
      </Text>
      {blackout.reason && (
        <Text as="span" variant="bodySm" tone="subdued">
          {blackout.reason}
        </Text>
      )}
    </BlockStack>,
    <InlineStack key={`type-${blackout.id}`} gap="200">
      {blackout.isRecurring ? (
        <Badge tone="info">Recurring</Badge>
      ) : blackout.dateEnd ? (
        <Badge>Range</Badge>
      ) : (
        <Badge>Single</Badge>
      )}
    </InlineStack>,
    getTimeDescription(blackout),
    blackout.isActive ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge tone="critical">Inactive</Badge>
    ),
    <InlineStack key={blackout.id} gap="200">
      <Button size="slim" onClick={() => handleToggle(blackout.id)}>
        {blackout.isActive ? "Disable" : "Enable"}
      </Button>
      <Button size="slim" tone="critical" onClick={() => handleDelete(blackout.id)}>
        Delete
      </Button>
    </InlineStack>,
  ]);

  const typeOptions = [
    { label: "Single date", value: "single" },
    { label: "Date range", value: "range" },
    { label: "Recurring weekly", value: "recurring" },
  ];

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Blackout Dates"
      primaryAction={{
        content: "Add blackout",
        onAction: () => setModalOpen(true),
      }}
    >
      <TitleBar title="Blackout Dates" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p" variant="bodySm" tone="subdued">
                Block specific dates or time windows from being available for customer pickups.
              </Text>

              {blackouts.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Date/Description", "Type", "Time Window", "Status", "Actions"]}
                  rows={tableRows}
                />
              ) : (
                <EmptyState
                  heading="No blackout dates configured"
                  action={{
                    content: "Add blackout",
                    onAction: () => setModalOpen(true),
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Add blackout dates for holidays, vacations, or other closures.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                About Blackouts
              </Text>
              <Text as="p" variant="bodySm">
                Blackout dates prevent customers from selecting pickup times during specific periods.
              </Text>
              <Divider />
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Types of blackouts:
              </Text>
              <Text as="p" variant="bodySm">
                • <strong>Single date:</strong> Block one specific date
              </Text>
              <Text as="p" variant="bodySm">
                • <strong>Date range:</strong> Block a range of consecutive dates
              </Text>
              <Text as="p" variant="bodySm">
                • <strong>Recurring:</strong> Block the same day every week
              </Text>
              <Divider />
              <Text as="p" variant="bodySm">
                You can also set partial day blackouts to block only specific hours.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Blackout Date"
        primaryAction={{
          content: "Add",
          onAction: handleCreate,
          loading: isLoading,
          disabled:
            (blackoutType === "single" && !newBlackout.date) ||
            (blackoutType === "range" && (!newBlackout.dateStart || !newBlackout.dateEnd)),
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Blackout type"
              options={typeOptions}
              value={blackoutType}
              onChange={setBlackoutType}
            />

            {blackoutType === "single" && (
              <TextField
                type="date"
                label="Date"
                value={newBlackout.date}
                onChange={(v) => setNewBlackout({ ...newBlackout, date: v })}
                autoComplete="off"
              />
            )}

            {blackoutType === "range" && (
              <>
                <TextField
                  type="date"
                  label="Start date"
                  value={newBlackout.dateStart}
                  onChange={(v) => setNewBlackout({ ...newBlackout, dateStart: v })}
                  autoComplete="off"
                />
                <TextField
                  type="date"
                  label="End date"
                  value={newBlackout.dateEnd}
                  onChange={(v) => setNewBlackout({ ...newBlackout, dateEnd: v })}
                  autoComplete="off"
                />
              </>
            )}

            {blackoutType === "recurring" && (
              <Select
                label="Day of week"
                options={dayOptions}
                value={newBlackout.dayOfWeek}
                onChange={(v) => setNewBlackout({ ...newBlackout, dayOfWeek: v })}
              />
            )}

            <Divider />

            <Checkbox
              label="Partial day blackout"
              checked={newBlackout.hasTimeWindow}
              onChange={(v) => setNewBlackout({ ...newBlackout, hasTimeWindow: v })}
              helpText="Only block specific hours instead of the full day"
            />

            {newBlackout.hasTimeWindow && (
              <InlineStack gap="400">
                <Select
                  label="Start time"
                  options={timeOptions}
                  value={newBlackout.startTime}
                  onChange={(v) => setNewBlackout({ ...newBlackout, startTime: v })}
                />
                <Select
                  label="End time"
                  options={timeOptions}
                  value={newBlackout.endTime}
                  onChange={(v) => setNewBlackout({ ...newBlackout, endTime: v })}
                />
              </InlineStack>
            )}

            <TextField
              label="Reason (optional)"
              value={newBlackout.reason}
              onChange={(v) => setNewBlackout({ ...newBlackout, reason: v })}
              placeholder="e.g., Holiday, Vacation, Maintenance"
              autoComplete="off"
            />

            {blackoutType === "recurring" && (
              <Banner tone="info">
                This will block every {getDayLabel(parseInt(newBlackout.dayOfWeek))} until disabled or deleted.
              </Banner>
            )}
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
