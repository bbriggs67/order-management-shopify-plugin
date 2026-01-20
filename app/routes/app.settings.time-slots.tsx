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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const timeSlots = await prisma.timeSlot.findMany({
    where: { shop },
    orderBy: [{ sortOrder: "asc" }, { startTime: "asc" }],
  });

  return json({ timeSlots });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "create") {
    const label = formData.get("label") as string;
    const startTime = formData.get("startTime") as string;
    const endTime = formData.get("endTime") as string;
    const dayOfWeek = formData.get("dayOfWeek") as string;

    // Get max sort order
    const maxSort = await prisma.timeSlot.findFirst({
      where: { shop },
      orderBy: { sortOrder: "desc" },
    });

    await prisma.timeSlot.create({
      data: {
        shop,
        label,
        startTime,
        endTime,
        dayOfWeek: dayOfWeek === "all" ? null : parseInt(dayOfWeek),
        isActive: true,
        sortOrder: (maxSort?.sortOrder || 0) + 1,
      },
    });
  } else if (action === "toggle") {
    const id = formData.get("id") as string;
    const slot = await prisma.timeSlot.findUnique({ where: { id } });
    if (slot) {
      await prisma.timeSlot.update({
        where: { id },
        data: { isActive: !slot.isActive },
      });
    }
  } else if (action === "delete") {
    const id = formData.get("id") as string;
    await prisma.timeSlot.delete({ where: { id } });
  }

  return json({ success: true });
};

export default function TimeSlotsSettings() {
  const { timeSlots } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [modalOpen, setModalOpen] = useState(false);
  const [newSlot, setNewSlot] = useState({
    startTime: "12:00",
    endTime: "14:00",
    dayOfWeek: "all",
  });

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

  const dayOptions = [
    { label: "All days", value: "all" },
    { label: "Sunday", value: "0" },
    { label: "Monday", value: "1" },
    { label: "Tuesday", value: "2" },
    { label: "Wednesday", value: "3" },
    { label: "Thursday", value: "4" },
    { label: "Friday", value: "5" },
    { label: "Saturday", value: "6" },
  ];

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const displayHour = hour % 12 || 12;
    const ampm = hour < 12 ? "AM" : "PM";
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getDayLabel = (dayOfWeek: number | null) => {
    if (dayOfWeek === null) return "All days";
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[dayOfWeek];
  };

  const generateLabel = (startTime: string, endTime: string) => {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  };

  const handleCreate = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "create");
    formData.append("label", generateLabel(newSlot.startTime, newSlot.endTime));
    formData.append("startTime", newSlot.startTime);
    formData.append("endTime", newSlot.endTime);
    formData.append("dayOfWeek", newSlot.dayOfWeek);
    submit(formData, { method: "post" });
    setModalOpen(false);
    setNewSlot({ startTime: "12:00", endTime: "14:00", dayOfWeek: "all" });
  }, [newSlot, submit]);

  const handleToggle = useCallback((id: string) => {
    const formData = new FormData();
    formData.append("_action", "toggle");
    formData.append("id", id);
    submit(formData, { method: "post" });
  }, [submit]);

  const handleDelete = useCallback((id: string) => {
    if (confirm("Are you sure you want to delete this time slot?")) {
      const formData = new FormData();
      formData.append("_action", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
    }
  }, [submit]);

  const tableRows = timeSlots.map((slot) => [
    slot.label,
    getDayLabel(slot.dayOfWeek),
    slot.isActive ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge tone="critical">Inactive</Badge>
    ),
    <InlineStack key={slot.id} gap="200">
      <Button size="slim" onClick={() => handleToggle(slot.id)}>
        {slot.isActive ? "Disable" : "Enable"}
      </Button>
      <Button size="slim" tone="critical" onClick={() => handleDelete(slot.id)}>
        Delete
      </Button>
    </InlineStack>,
  ]);

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Time Slots"
      primaryAction={{
        content: "Add time slot",
        onAction: () => setModalOpen(true),
      }}
    >
      <TitleBar title="Time Slots" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p" variant="bodySm" tone="subdued">
                Configure the pickup time windows available to customers. Time slots can be set for all days or specific days of the week.
              </Text>

              {timeSlots.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Time Slot", "Available On", "Status", "Actions"]}
                  rows={tableRows}
                />
              ) : (
                <EmptyState
                  heading="No time slots configured"
                  action={{
                    content: "Add time slot",
                    onAction: () => setModalOpen(true),
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Add pickup time windows for your customers to choose from.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Suggested time slots
              </Text>
              <Text as="p" variant="bodySm">
                Common time slots for bakery pickups:
              </Text>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm">• 10:00 AM - 12:00 PM</Text>
                <Text as="p" variant="bodySm">• 12:00 PM - 2:00 PM</Text>
                <Text as="p" variant="bodySm">• 2:00 PM - 4:00 PM</Text>
                <Text as="p" variant="bodySm">• 4:00 PM - 6:00 PM</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Time Slot"
        primaryAction={{
          content: "Add",
          onAction: handleCreate,
          loading: isLoading,
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
              label="Start time"
              options={timeOptions}
              value={newSlot.startTime}
              onChange={(v) => setNewSlot({ ...newSlot, startTime: v })}
            />
            <Select
              label="End time"
              options={timeOptions}
              value={newSlot.endTime}
              onChange={(v) => setNewSlot({ ...newSlot, endTime: v })}
            />
            <Select
              label="Available on"
              options={dayOptions}
              value={newSlot.dayOfWeek}
              onChange={(v) => setNewSlot({ ...newSlot, dayOfWeek: v })}
              helpText="Select 'All days' to make this slot available every day, or choose a specific day"
            />
            <Text as="p" variant="bodySm" tone="subdued">
              Preview: {generateLabel(newSlot.startTime, newSlot.endTime)}
            </Text>
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
