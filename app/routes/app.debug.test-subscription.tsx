/**
 * Debug: Test Subscription Creation
 *
 * Simulates the webhook subscription flow by creating a SubscriptionPickup
 * record and future pickup schedules, WITHOUT requiring a live Shopify order.
 *
 * Access via SSMA admin → Debug → Test Subscription
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Select,
  TextField,
  Banner,
  Divider,
  DataTable,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscriptionFromOrder } from "../services/subscription.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get recent subscriptions to show test results
  const recentSubscriptions = await prisma.subscriptionPickup.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Get recent pickup schedules linked to subscriptions
  const recentPickups = await prisma.pickupSchedule.findMany({
    where: {
      shop,
      subscriptionPickupId: { not: null },
    },
    orderBy: { pickupDate: "asc" },
    take: 20,
  });

  return json({
    shop,
    recentSubscriptions: recentSubscriptions.map((s) => ({
      id: s.id,
      customerName: s.customerName,
      frequency: s.frequency,
      status: s.status,
      preferredDay: s.preferredDay,
      nextPickupDate: s.nextPickupDate?.toISOString() || null,
      shopifyOrderNumber: s.shopifyOrderNumber,
      shopifyContractId: s.shopifyContractId,
      createdAt: s.createdAt.toISOString(),
    })),
    recentPickups: recentPickups.map((p) => ({
      id: p.id,
      orderNumber: p.shopifyOrderNumber,
      customerName: p.customerName,
      pickupDate: p.pickupDate.toISOString(),
      pickupTimeSlot: p.pickupTimeSlot,
      pickupStatus: p.pickupStatus,
      subscriptionPickupId: p.subscriptionPickupId,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create_test_subscription") {
    const customerName = (formData.get("customerName") as string) || "Test Customer";
    const customerEmail = (formData.get("customerEmail") as string) || "test@example.com";
    const frequency = (formData.get("frequency") as string) || "WEEKLY";
    const preferredDay = parseInt(formData.get("preferredDay") as string, 10) || 2; // Tuesday
    const preferredTimeSlot = (formData.get("preferredTimeSlot") as string) || "12:00 PM - 2:00 PM";

    try {
      // Create a fake order ID for testing
      const testOrderId = `gid://shopify/Order/test-${Date.now()}`;
      const testOrderNumber = `#TEST-${Date.now().toString().slice(-6)}`;

      const subscriptionId = await createSubscriptionFromOrder(
        shop,
        testOrderId,
        testOrderNumber,
        customerName,
        customerEmail,
        null, // phone
        frequency as "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY",
        preferredDay,
        preferredTimeSlot,
        "Test Subscription Product"
      );

      // Create a pickup schedule for the initial order
      const nextPickupDate = new Date();
      nextPickupDate.setDate(nextPickupDate.getDate() + ((preferredDay - nextPickupDate.getDay() + 7) % 7 || 7));
      nextPickupDate.setHours(12, 0, 0, 0);

      const initialPickup = await prisma.pickupSchedule.create({
        data: {
          shop,
          shopifyOrderId: testOrderId,
          shopifyOrderNumber: testOrderNumber,
          customerName,
          customerEmail,
          pickupDate: nextPickupDate,
          pickupTimeSlot: preferredTimeSlot,
          pickupStatus: "SCHEDULED",
          subscriptionPickupId: subscriptionId,
        },
      });

      // Create 4 weeks of future pickups
      const frequencyDays = frequency === "BIWEEKLY" ? 14 : frequency === "TRIWEEKLY" ? 21 : 7;
      const futurePickups = [];

      for (let week = 1; week <= 4; week++) {
        const futureDate = new Date(nextPickupDate);
        futureDate.setDate(futureDate.getDate() + (week * frequencyDays));

        const fp = await prisma.pickupSchedule.create({
          data: {
            shop,
            shopifyOrderId: `subscription-${subscriptionId}-week${week}`,
            shopifyOrderNumber: `${testOrderNumber}-W${week}`,
            customerName,
            customerEmail,
            pickupDate: futureDate,
            pickupTimeSlot: preferredTimeSlot,
            pickupStatus: "SCHEDULED",
            subscriptionPickupId: subscriptionId,
          },
        });
        futurePickups.push(fp.id);
      }

      return json({
        success: true,
        message: `Test subscription created: ${subscriptionId}`,
        subscriptionId,
        initialPickupId: initialPickup.id,
        futurePickupCount: futurePickups.length,
      });
    } catch (error) {
      console.error("Test subscription error:", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (intent === "delete_test_subscriptions") {
    try {
      // Delete test subscriptions and their pickup schedules
      const testSubscriptions = await prisma.subscriptionPickup.findMany({
        where: {
          shop,
          shopifyContractId: { startsWith: "gid://shopify/Order/test-" },
        },
      });

      for (const sub of testSubscriptions) {
        // Delete associated pickup schedules first
        await prisma.pickupSchedule.deleteMany({
          where: { subscriptionPickupId: sub.id },
        });
      }

      // Delete the subscriptions
      const deleted = await prisma.subscriptionPickup.deleteMany({
        where: {
          shop,
          shopifyContractId: { startsWith: "gid://shopify/Order/test-" },
        },
      });

      return json({
        success: true,
        message: `Deleted ${deleted.count} test subscription(s)`,
      });
    } catch (error) {
      console.error("Delete test subscriptions error:", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TestSubscription() {
  const { recentSubscriptions, recentPickups } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [customerName, setCustomerName] = useState("Test Customer");
  const [customerEmail, setCustomerEmail] = useState("test@example.com");
  const [frequency, setFrequency] = useState("WEEKLY");
  const [preferredDay, setPreferredDay] = useState("2"); // Tuesday
  const [timeSlot, setTimeSlot] = useState("12:00 PM - 2:00 PM");

  const handleCreateTest = useCallback(() => {
    submit(
      {
        intent: "create_test_subscription",
        customerName,
        customerEmail,
        frequency,
        preferredDay,
        preferredTimeSlot: timeSlot,
      },
      { method: "post" }
    );
  }, [submit, customerName, customerEmail, frequency, preferredDay, timeSlot]);

  const handleDeleteTests = useCallback(() => {
    submit({ intent: "delete_test_subscriptions" }, { method: "post" });
  }, [submit]);

  return (
    <Page
      title="Test Subscription Creation"
      backAction={{ url: "/app/debug" }}
    >
      <TitleBar title="Test Subscription" />
      <Layout>
        <Layout.Section>
          {actionData && "success" in actionData && (
            <Banner
              title={actionData.success ? "Success" : "Error"}
              tone={actionData.success ? "success" : "critical"}
            >
              <p>{"message" in actionData ? actionData.message : "error" in actionData ? actionData.error : ""}</p>
            </Banner>
          )}
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Create Test Subscription</Text>
              <Text as="p" tone="subdued">
                Simulates what the orders/create webhook does: creates a SubscriptionPickup record
                and future pickup schedules. No real Shopify order required.
              </Text>
              <Divider />
              <InlineStack gap="400" wrap>
                <div style={{ minWidth: 200 }}>
                  <TextField label="Customer Name" value={customerName} onChange={setCustomerName} autoComplete="off" />
                </div>
                <div style={{ minWidth: 200 }}>
                  <TextField label="Email" value={customerEmail} onChange={setCustomerEmail} autoComplete="off" />
                </div>
              </InlineStack>
              <InlineStack gap="400" wrap>
                <div style={{ minWidth: 200 }}>
                  <Select
                    label="Frequency"
                    options={[
                      { label: "Weekly", value: "WEEKLY" },
                      { label: "Bi-Weekly", value: "BIWEEKLY" },
                      { label: "Tri-Weekly", value: "TRIWEEKLY" },
                    ]}
                    value={frequency}
                    onChange={setFrequency}
                  />
                </div>
                <div style={{ minWidth: 200 }}>
                  <Select
                    label="Preferred Day"
                    options={DAY_NAMES.map((name, i) => ({ label: name, value: String(i) }))}
                    value={preferredDay}
                    onChange={setPreferredDay}
                  />
                </div>
                <div style={{ minWidth: 200 }}>
                  <TextField label="Time Slot" value={timeSlot} onChange={setTimeSlot} autoComplete="off" />
                </div>
              </InlineStack>
              <InlineStack gap="400">
                <Button variant="primary" onClick={handleCreateTest} loading={isSubmitting}>
                  Create Test Subscription
                </Button>
                <Button tone="critical" onClick={handleDeleteTests} loading={isSubmitting}>
                  Delete All Test Subscriptions
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Recent Subscriptions (All)</Text>
              {recentSubscriptions.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                  headings={["Order #", "Customer", "Frequency", "Day", "Next Pickup", "Status"]}
                  rows={recentSubscriptions.map((s) => [
                    s.shopifyOrderNumber || "—",
                    s.customerName,
                    s.frequency,
                    DAY_NAMES[s.preferredDay] || "?",
                    s.nextPickupDate
                      ? new Date(s.nextPickupDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                      : "—",
                    s.status,
                  ])}
                />
              ) : (
                <Text as="p" tone="subdued">No subscriptions found</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Recent Subscription Pickups</Text>
              {recentPickups.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Order #", "Customer", "Pickup Date", "Time", "Status"]}
                  rows={recentPickups.map((p) => [
                    p.orderNumber || "—",
                    p.customerName,
                    new Date(p.pickupDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
                    p.pickupTimeSlot,
                    p.pickupStatus,
                  ])}
                />
              ) : (
                <Text as="p" tone="subdued">No subscription pickups found</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
