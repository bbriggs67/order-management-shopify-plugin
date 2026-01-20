import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, Link } from "@remix-run/react";
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
  DataTable,
  DescriptionList,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendReadyNotification } from "../services/notifications.server";
import { updatePickupEvent, deletePickupEvent } from "../services/google-calendar.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { orderId } = params;

  if (!orderId) {
    throw new Response("Order ID required", { status: 400 });
  }

  const pickup = await prisma.pickupSchedule.findFirst({
    where: {
      shop,
      id: orderId,
    },
    include: {
      orderItems: true,
      pickupLocation: true,
      notificationLogs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!pickup) {
    throw new Response("Order not found", { status: 404 });
  }

  return json({ pickup });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { orderId } = params;

  if (!orderId) {
    return json({ error: "Order ID required" }, { status: 400 });
  }

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  const pickup = await prisma.pickupSchedule.findFirst({
    where: { shop, id: orderId },
  });

  if (!pickup) {
    return json({ error: "Order not found" }, { status: 404 });
  }

  if (action === "updateStatus") {
    const newStatus = formData.get("status") as string;
    const validStatuses = ["SCHEDULED", "READY", "PICKED_UP", "CANCELLED", "NO_SHOW"];

    if (!validStatuses.includes(newStatus)) {
      return json({ error: "Invalid status" }, { status: 400 });
    }

    await prisma.pickupSchedule.update({
      where: { id: orderId },
      data: { pickupStatus: newStatus as any },
    });

    // If marking as READY, send notification
    if (newStatus === "READY") {
      try {
        await sendReadyNotification(orderId, shop);
      } catch (error) {
        console.error("Failed to send notification:", error);
        // Continue even if notification fails - status was updated
      }
    }

    // Update Google Calendar event
    if (newStatus === "CANCELLED") {
      try {
        await deletePickupEvent(shop, orderId);
      } catch (error) {
        console.error("Failed to delete Google Calendar event:", error);
      }
    } else {
      try {
        await updatePickupEvent(shop, orderId);
      } catch (error) {
        console.error("Failed to update Google Calendar event:", error);
      }
    }

    return json({ success: true, status: newStatus });
  }

  if (action === "updateNotes") {
    const notes = formData.get("notes") as string;

    await prisma.pickupSchedule.update({
      where: { id: orderId },
      data: { notes },
    });

    return json({ success: true });
  }

  if (action === "resendNotification") {
    try {
      await sendReadyNotification(orderId, shop);
      return json({ success: true, message: "Notification sent" });
    } catch (error) {
      console.error("Failed to send notification:", error);
      return json({ error: "Failed to send notification" }, { status: 500 });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function OrderDetail() {
  const { pickup } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [notes, setNotes] = useState(pickup.notes || "");
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { tone: any; label: string }> = {
      SCHEDULED: { tone: "info", label: "Scheduled" },
      READY: { tone: "success", label: "Ready for Pickup" },
      PICKED_UP: { tone: "success", label: "Picked Up" },
      CANCELLED: { tone: "critical", label: "Cancelled" },
      NO_SHOW: { tone: "warning", label: "No Show" },
    };
    const config = statusMap[status] || { tone: "info", label: status };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  };

  const handleStatusChange = useCallback(
    (newStatus: string) => {
      const formData = new FormData();
      formData.append("_action", "updateStatus");
      formData.append("status", newStatus);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handleSaveNotes = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "updateNotes");
    formData.append("notes", notes);
    submit(formData, { method: "post" });
  }, [notes, submit]);

  const handleResendNotification = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "resendNotification");
    submit(formData, { method: "post" });
  }, [submit]);

  const handleConfirmCancel = useCallback(() => {
    handleStatusChange("CANCELLED");
    setCancelModalOpen(false);
  }, [handleStatusChange]);

  // Order items table
  const itemRows = pickup.orderItems.map((item) => [
    item.productTitle,
    item.variantTitle || "-",
    item.quantity.toString(),
  ]);

  // Notification history
  const notificationRows = pickup.notificationLogs.map((log) => [
    log.type,
    log.recipient,
    log.status,
    formatDateTime(log.createdAt),
  ]);

  // Can only mark as ready if currently scheduled
  const canMarkReady = pickup.pickupStatus === "SCHEDULED";
  const canMarkPickedUp = pickup.pickupStatus === "READY";
  const canCancel = ["SCHEDULED", "READY"].includes(pickup.pickupStatus);
  const canMarkNoShow = pickup.pickupStatus === "READY";
  const isCompleted = ["PICKED_UP", "CANCELLED", "NO_SHOW"].includes(pickup.pickupStatus);

  return (
    <Page
      backAction={{ content: "Orders", url: "/app/orders" }}
      title={`Order ${pickup.shopifyOrderNumber}`}
      titleMetadata={getStatusBadge(pickup.pickupStatus)}
      secondaryActions={[
        {
          content: "View in Shopify",
          url: `shopify://admin/orders/${pickup.shopifyOrderId.split("/").pop()}`,
          external: true,
        },
      ]}
    >
      <TitleBar title={`Order ${pickup.shopifyOrderNumber}`} />

      <Layout>
        {/* Main Content */}
        <Layout.Section>
          <BlockStack gap="400">
            {/* Status Actions */}
            {!isCompleted && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Actions
                  </Text>
                  <InlineStack gap="300">
                    {canMarkReady && (
                      <Button
                        variant="primary"
                        onClick={() => handleStatusChange("READY")}
                        loading={isLoading}
                      >
                        Mark as Ready
                      </Button>
                    )}
                    {canMarkPickedUp && (
                      <Button
                        variant="primary"
                        onClick={() => handleStatusChange("PICKED_UP")}
                        loading={isLoading}
                      >
                        Mark as Picked Up
                      </Button>
                    )}
                    {canMarkNoShow && (
                      <Button
                        onClick={() => handleStatusChange("NO_SHOW")}
                        loading={isLoading}
                      >
                        Mark as No Show
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        tone="critical"
                        onClick={() => setCancelModalOpen(true)}
                      >
                        Cancel Order
                      </Button>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {/* Completed Status Banner */}
            {isCompleted && (
              <Banner
                tone={pickup.pickupStatus === "PICKED_UP" ? "success" : "warning"}
              >
                This order has been marked as{" "}
                {pickup.pickupStatus === "PICKED_UP"
                  ? "picked up"
                  : pickup.pickupStatus === "CANCELLED"
                    ? "cancelled"
                    : "no show"}
                .
              </Banner>
            )}

            {/* Pickup Details */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Pickup Details
                </Text>
                <DescriptionList
                  items={[
                    {
                      term: "Pickup Date",
                      description: formatDate(pickup.pickupDate),
                    },
                    {
                      term: "Time Slot",
                      description: pickup.pickupTimeSlot,
                    },
                    {
                      term: "Location",
                      description: pickup.pickupLocation
                        ? `${pickup.pickupLocation.name} - ${pickup.pickupLocation.address}`
                        : "Default Location",
                    },
                  ]}
                />
              </BlockStack>
            </Card>

            {/* Order Items */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Order Items
                </Text>
                {pickup.orderItems.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={["Product", "Variant", "Qty"]}
                    rows={itemRows}
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    No items recorded.
                  </Text>
                )}
              </BlockStack>
            </Card>

            {/* Notes */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Notes
                </Text>
                <TextField
                  label="Order notes"
                  labelHidden
                  value={notes}
                  onChange={setNotes}
                  multiline={3}
                  autoComplete="off"
                  placeholder="Add notes about this order..."
                />
                <InlineStack align="end">
                  <Button onClick={handleSaveNotes} loading={isLoading}>
                    Save Notes
                  </Button>
                </InlineStack>
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
                    {pickup.customerName}
                  </Text>
                  {pickup.customerEmail && (
                    <Text as="p" variant="bodySm">
                      {pickup.customerEmail}
                    </Text>
                  )}
                  {pickup.customerPhone && (
                    <Text as="p" variant="bodySm">
                      {pickup.customerPhone}
                    </Text>
                  )}
                </BlockStack>
                {!pickup.customerEmail && !pickup.customerPhone && (
                  <Banner tone="warning">
                    No contact info available for notifications.
                  </Banner>
                )}
              </BlockStack>
            </Card>

            {/* Notification History */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Notifications
                  </Text>
                  {pickup.pickupStatus === "READY" && (
                    <Button size="slim" onClick={handleResendNotification}>
                      Resend
                    </Button>
                  )}
                </InlineStack>
                {pickup.notificationLogs.length > 0 ? (
                  <BlockStack gap="200">
                    {pickup.notificationLogs.map((log) => (
                      <Box
                        key={log.id}
                        padding="200"
                        background="bg-surface-secondary"
                        borderRadius="100"
                      >
                        <BlockStack gap="100">
                          <InlineStack align="space-between">
                            <Badge tone={log.status === "SENT" ? "success" : "critical"}>
                              {log.type}
                            </Badge>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {formatDateTime(log.createdAt)}
                            </Text>
                          </InlineStack>
                          <Text as="p" variant="bodySm">
                            {log.recipient}
                          </Text>
                          {log.errorMessage && (
                            <Text as="p" variant="bodySm" tone="critical">
                              {log.errorMessage}
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                ) : (
                  <Text as="p" tone="subdued">
                    No notifications sent yet.
                  </Text>
                )}
              </BlockStack>
            </Card>

            {/* Order Timeline */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Timeline
                </Text>
                <BlockStack gap="200">
                  <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">
                        Order created
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {formatDateTime(pickup.createdAt)}
                      </Text>
                    </InlineStack>
                  </Box>
                  {pickup.updatedAt !== pickup.createdAt && (
                    <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm">
                          Last updated
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {formatDateTime(pickup.updatedAt)}
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

      {/* Cancel Confirmation Modal */}
      <Modal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Cancel Order"
        primaryAction={{
          content: "Cancel Order",
          destructive: true,
          onAction: handleConfirmCancel,
        }}
        secondaryActions={[
          {
            content: "Keep Order",
            onAction: () => setCancelModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to cancel this order? This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
