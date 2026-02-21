import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, Link } from "@remix-run/react";
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
  Select,
  Checkbox,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendReadyNotification } from "../services/notifications.server";
import { updatePickupEvent, deletePickupEvent } from "../services/google-calendar.server";
import {
  cancelOrderWithRefund,
  getRefundableAmount,
  CANCELLATION_REASONS,
  type CancellationReason,
} from "../services/order-management.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const { orderId } = params;

  if (!orderId) {
    throw new Response("Order ID required", { status: 400 });
  }

  // orderId from URL can be either the Shopify GraphQL ID (gid://shopify/Order/...)
  // or the internal database ID. Try shopifyOrderId first, then fall back to id.
  const decodedOrderId = decodeURIComponent(orderId);
  const pickup = await prisma.pickupSchedule.findFirst({
    where: {
      shop,
      shopifyOrderId: decodedOrderId,
    },
    include: {
      orderItems: true,
      pickupLocation: true,
      subscriptionPickup: {
        select: { id: true, status: true },
      },
      notificationLogs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!pickup) {
    throw new Response("Order not found", { status: 404 });
  }

  // Get refundable amount from Shopify
  let refundableAmount: { amount: string; currencyCode: string } | null = null;
  if (pickup.pickupStatus !== "CANCELLED" && pickup.pickupStatus !== "PICKED_UP") {
    try {
      refundableAmount = await getRefundableAmount(admin, pickup.shopifyOrderId);
    } catch (error) {
      console.error("Error getting refundable amount:", error);
    }
  }

  // Look up CRM customer by email for "View Customer Profile" link + pinned notes
  let customerId: string | null = null;
  let customerNotes: Array<{ id: string; content: string; category: string | null; createdAt: Date }> = [];
  if (pickup.customerEmail) {
    const customer = await prisma.customer.findFirst({
      where: { shop, email: pickup.customerEmail.toLowerCase().trim() },
      select: {
        id: true,
        notes: {
          where: { isPinned: true },
          orderBy: { createdAt: "desc" },
          select: { id: true, content: true, category: true, createdAt: true },
        },
      },
    });
    customerId = customer?.id || null;
    customerNotes = customer?.notes || [];
  }

  return json({
    pickup,
    customerId,
    customerNotes,
    refundableAmount,
    cancellationReasons: CANCELLATION_REASONS,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const { orderId } = params;

  if (!orderId) {
    return json({ error: "Order ID required" }, { status: 400 });
  }

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  const decodedOrderId = decodeURIComponent(orderId);
  const pickup = await prisma.pickupSchedule.findFirst({
    where: { shop, shopifyOrderId: decodedOrderId },
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
      where: { id: pickup.id },
      data: { pickupStatus: newStatus as any },
    });

    // Sync status to Shopify via tags and fulfillment
    try {
      // Map SSMA status to Shopify tags
      const statusTagMap: Record<string, string> = {
        SCHEDULED: "pickup-scheduled",
        READY: "pickup-ready",
        PICKED_UP: "pickup-completed",
        CANCELLED: "pickup-cancelled",
        NO_SHOW: "pickup-no-show",
      };

      // Remove old pickup status tags and add new one
      const allStatusTags = Object.values(statusTagMap);
      const newTag = statusTagMap[newStatus];

      // Get current tags
      const orderResponse = await admin.graphql(`
        query getOrderTags($id: ID!) {
          order(id: $id) {
            id
            tags
          }
        }
      `, { variables: { id: pickup.shopifyOrderId } });

      const orderData = await orderResponse.json();
      const currentTags: string[] = orderData.data?.order?.tags || [];

      // Filter out old status tags and add new one
      const updatedTags = currentTags
        .filter((tag: string) => !allStatusTags.includes(tag))
        .concat(newTag);

      // Update tags in Shopify
      await admin.graphql(`
        mutation updateOrderTags($input: OrderInput!) {
          orderUpdate(input: $input) {
            order {
              id
              tags
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            id: pickup.shopifyOrderId,
            tags: updatedTags,
          },
        },
      });

      // If marking as PICKED_UP, also mark order as fulfilled in Shopify
      if (newStatus === "PICKED_UP") {
        try {
          // Get fulfillment order
          const fulfillmentResponse = await admin.graphql(`
            query getFulfillmentOrders($orderId: ID!) {
              order(id: $orderId) {
                fulfillmentOrders(first: 5) {
                  nodes {
                    id
                    status
                    lineItems(first: 50) {
                      nodes {
                        id
                        remainingQuantity
                      }
                    }
                  }
                }
              }
            }
          `, { variables: { orderId: pickup.shopifyOrderId } });

          const fulfillmentData = await fulfillmentResponse.json();
          const fulfillmentOrders = fulfillmentData.data?.order?.fulfillmentOrders?.nodes || [];

          // Find unfulfilled orders
          const unfulfilledOrder = fulfillmentOrders.find(
            (fo: { status: string }) => fo.status === "OPEN" || fo.status === "IN_PROGRESS"
          );

          if (unfulfilledOrder) {
            const lineItems = unfulfilledOrder.lineItems.nodes
              .filter((li: { remainingQuantity: number }) => li.remainingQuantity > 0)
              .map((li: { id: string }) => ({ fulfillmentOrderLineItemId: li.id }));

            if (lineItems.length > 0) {
              await admin.graphql(`
                mutation fulfillOrder($fulfillment: FulfillmentV2Input!) {
                  fulfillmentCreateV2(fulfillment: $fulfillment) {
                    fulfillment {
                      id
                      status
                    }
                    userErrors {
                      field
                      message
                    }
                  }
                }
              `, {
                variables: {
                  fulfillment: {
                    lineItemsByFulfillmentOrder: [
                      {
                        fulfillmentOrderId: unfulfilledOrder.id,
                        fulfillmentOrderLineItems: lineItems,
                      },
                    ],
                    notifyCustomer: false,
                    trackingInfo: {
                      company: "In-Store Pickup",
                      number: `PICKUP-${pickup.shopifyOrderNumber}`,
                    },
                  },
                },
              });
              console.log(`Fulfilled order ${pickup.shopifyOrderNumber} in Shopify`);
            }
          }
        } catch (fulfillError) {
          console.error("Failed to fulfill order in Shopify:", fulfillError);
          // Continue - status was still updated
        }
      }

      console.log(`Synced status "${newStatus}" to Shopify for order ${pickup.shopifyOrderNumber}`);
    } catch (syncError) {
      console.error("Failed to sync status to Shopify:", syncError);
      // Continue - SSMA status was updated
    }

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

    return json({ success: true, status: newStatus, message: `Status updated to ${newStatus}` });
  }

  if (action === "updateNotes") {
    const notes = formData.get("notes") as string;

    await prisma.pickupSchedule.update({
      where: { id: pickup.id },
      data: { notes },
    });

    return json({ success: true });
  }

  if (action === "resendNotification") {
    try {
      await sendReadyNotification(pickup.id, shop);
      return json({ success: true, message: "Notification sent" });
    } catch (error) {
      console.error("Failed to send notification:", error);
      return json({ error: "Failed to send notification" }, { status: 500 });
    }
  }

  if (action === "cancelAndRefund") {
    // Note: admin is already authenticated at the top of the action function
    const reason = formData.get("reason") as CancellationReason;
    const staffNote = formData.get("staffNote") as string;
    const restockInventory = formData.get("restockInventory") === "true";
    const notifyCustomer = formData.get("notifyCustomer") === "true";

    if (!reason) {
      return json({ error: "Cancellation reason is required" }, { status: 400 });
    }

    // Get the pickup with subscription info
    const pickupWithSub = await prisma.pickupSchedule.findFirst({
      where: { shop, id: pickup.id },
      include: { subscriptionPickup: true },
    });

    if (!pickupWithSub) {
      return json({ error: "Order not found" }, { status: 404 });
    }

    // Cancel and refund in Shopify
    const result = await cancelOrderWithRefund(admin, {
      orderId: pickupWithSub.shopifyOrderId,
      reason,
      staffNote,
      restockInventory,
      notifyCustomer,
    });

    if (!result.success) {
      return json({ error: result.error || "Failed to cancel order" }, { status: 500 });
    }

    // Update SSMA pickup status and linked subscription atomically
    await prisma.$transaction(async (tx) => {
      // Update pickup status
      await tx.pickupSchedule.update({
        where: { id: pickup.id },
        data: {
          pickupStatus: "CANCELLED",
          notes: pickupWithSub.notes
            ? `${pickupWithSub.notes}\n\nCancelled: ${reason}${staffNote ? ` - ${staffNote}` : ""}`
            : `Cancelled: ${reason}${staffNote ? ` - ${staffNote}` : ""}`,
        },
      });

      // If linked to a subscription, also cancel it within the same transaction
      if (pickupWithSub.subscriptionPickupId) {
        await tx.subscriptionPickup.update({
          where: { id: pickupWithSub.subscriptionPickupId },
          data: { status: "CANCELLED" },
        });
      }
    });

    // Delete Google Calendar event
    try {
      await deletePickupEvent(shop, orderId);
    } catch (error) {
      console.error("Failed to delete Google Calendar event:", error);
    }

    const refundMessage = result.refundAmount
      ? ` Refunded $${result.refundAmount} ${result.currencyCode}.`
      : "";

    return json({
      success: true,
      message: `Order cancelled successfully.${refundMessage}`,
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function OrderDetail() {
  const { pickup, customerId, customerNotes, refundableAmount, cancellationReasons } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [notes, setNotes] = useState(pickup.notes || "");
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  // Cancel modal state
  const [cancelReason, setCancelReason] = useState<string>("CUSTOMER");
  const [cancelStaffNote, setCancelStaffNote] = useState("");
  const [restockInventory, setRestockInventory] = useState(true);
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
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
    const formData = new FormData();
    formData.append("_action", "cancelAndRefund");
    formData.append("reason", cancelReason);
    formData.append("staffNote", cancelStaffNote);
    formData.append("restockInventory", restockInventory.toString());
    formData.append("notifyCustomer", notifyCustomer.toString());
    submit(formData, { method: "post" });
    setCancelModalOpen(false);
  }, [submit, cancelReason, cancelStaffNote, restockInventory, notifyCustomer]);

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
        {/* Action Result Messages */}
        {actionData && "success" in actionData && actionData.success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => {}}>
              {"message" in actionData ? actionData.message : "Action completed successfully."}
            </Banner>
          </Layout.Section>
        )}
        {actionData && "error" in actionData && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => {}}>
              {actionData.error}
            </Banner>
          </Layout.Section>
        )}

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
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Customer
                  </Text>
                  {customerId && (
                    <Link to={`/app/customers/${customerId}`}>
                      <Button size="slim" variant="plain">View Profile</Button>
                    </Link>
                  )}
                </InlineStack>
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

            {/* Customer Notes (pinned, from CRM) */}
            {customerNotes.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Customer Notes
                    </Text>
                    {customerId && (
                      <Link to={`/app/customers/${customerId}`}>
                        <Button size="slim" variant="plain">
                          Manage
                        </Button>
                      </Link>
                    )}
                  </InlineStack>
                  <BlockStack gap="200">
                    {customerNotes.map((note) => (
                      <Box
                        key={note.id}
                        padding="200"
                        background="bg-surface-success"
                        borderRadius="100"
                      >
                        <BlockStack gap="100">
                          <InlineStack gap="100">
                            {note.category && (
                              <Badge size="small">
                                {note.category.charAt(0).toUpperCase() + note.category.slice(1)}
                              </Badge>
                            )}
                          </InlineStack>
                          <Text as="p" variant="bodySm">
                            {note.content}
                          </Text>
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}

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

      {/* Cancel and Refund Modal */}
      <Modal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title={`Cancel order ${pickup.shopifyOrderNumber}?`}
        primaryAction={{
          content: "Cancel Order",
          destructive: true,
          onAction: handleConfirmCancel,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Keep Order",
            onAction: () => setCancelModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {/* Refund Info */}
            {refundableAmount && parseFloat(refundableAmount.amount) > 0 && (
              <Banner tone="info">
                <Text as="p">
                  A full refund of <strong>${refundableAmount.amount} {refundableAmount.currencyCode}</strong> will be issued to the original payment method.
                </Text>
              </Banner>
            )}

            {/* Linked Subscription Warning */}
            {pickup.subscriptionPickup && (
              <Banner tone="warning">
                <Text as="p">
                  This order is linked to a subscription. Cancelling will also cancel the subscription.
                </Text>
              </Banner>
            )}

            {/* Reason for cancellation */}
            <Select
              label="Reason for cancellation"
              options={cancellationReasons.map((r) => ({
                label: r.label,
                value: r.value,
              }))}
              value={cancelReason}
              onChange={setCancelReason}
            />

            {/* Staff note */}
            <TextField
              label="Staff note"
              value={cancelStaffNote}
              onChange={setCancelStaffNote}
              multiline={2}
              autoComplete="off"
              helpText="Only you and other staff can see this note."
            />

            {/* Options */}
            <BlockStack gap="200">
              <Checkbox
                label="Restock inventory"
                checked={restockInventory}
                onChange={setRestockInventory}
              />
              <Checkbox
                label="Send a notification to the customer"
                checked={notifyCustomer}
                onChange={setNotifyCustomer}
              />
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
