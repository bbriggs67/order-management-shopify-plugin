import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  Badge,
  Box,
  Checkbox,
  TextField,
  Divider,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getMigrationStatus, runMigration } from "../services/migration.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const status = await getMigrationStatus(admin, shop);
    return json({ shop, status, error: null });
  } catch (error) {
    console.error("Error getting migration status:", error);
    return json({
      shop,
      status: null,
      error: error instanceof Error ? error.message : "Failed to get migration status",
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "run_migration") {
    const importOrders = formData.get("importOrders") === "true";
    const importSubscriptions = formData.get("importSubscriptions") === "true";
    const createCalendarEvents = formData.get("createCalendarEvents") === "true";
    const dryRun = formData.get("dryRun") === "true";
    const ordersDaysBack = parseInt(formData.get("ordersDaysBack") as string) || 30;

    try {
      const result = await runMigration(admin, shop, {
        importOrders,
        importSubscriptions,
        createCalendarEvents,
        dryRun,
        ordersDaysBack,
      });

      return json({ success: true, result });
    } catch (error) {
      console.error("Migration error:", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Migration failed",
      });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function MigrationPage() {
  const { shop, status, error } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  // Form state
  const [importOrders, setImportOrders] = useState(true);
  const [importSubscriptions, setImportSubscriptions] = useState(true);
  const [createCalendarEvents, setCreateCalendarEvents] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [ordersDaysBack, setOrdersDaysBack] = useState("30");

  const handleRunMigration = () => {
    const formData = new FormData();
    formData.append("intent", "run_migration");
    formData.append("importOrders", importOrders.toString());
    formData.append("importSubscriptions", importSubscriptions.toString());
    formData.append("createCalendarEvents", createCalendarEvents.toString());
    formData.append("dryRun", dryRun.toString());
    formData.append("ordersDaysBack", ordersDaysBack);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Data Migration"
    >
      <TitleBar title="Data Migration" />

      <Layout>
        {/* Warning Banner */}
        <Layout.Section>
          <Banner tone="warning">
            <p>
              <strong>Important:</strong> This tool imports existing orders and subscriptions
              from Shopify into SSMA. Run this after switching from Bird/Shopify Subscriptions
              to ensure all active data appears in SSMA's Orders, Subscriptions, and Calendar pages.
            </p>
          </Banner>
        </Layout.Section>

        {/* Error Display */}
        {error && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Migration Status */}
        {status && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Current Status</Text>
                <Text as="p" tone="subdued">
                  Comparison of data in Shopify vs SSMA database
                </Text>

                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="span" fontWeight="semibold">Active Orders in Shopify:</Text>
                      <Badge>{status.shopifyOrders}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" fontWeight="semibold">Orders in SSMA:</Text>
                      <Badge tone={status.ssmaOrders >= status.shopifyOrders ? "success" : "attention"}>
                        {status.ssmaOrders}
                      </Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" fontWeight="semibold">Pending Order Imports:</Text>
                      <Badge tone={status.pendingOrders > 0 ? "warning" : "success"}>
                        {status.pendingOrders}
                      </Badge>
                    </InlineStack>

                    <Divider />

                    <InlineStack align="space-between">
                      <Text as="span" fontWeight="semibold">Active Subscriptions in Shopify:</Text>
                      <Badge>{status.shopifySubscriptions}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" fontWeight="semibold">Subscriptions in SSMA:</Text>
                      <Badge tone={status.ssmaSubscriptions >= status.shopifySubscriptions ? "success" : "attention"}>
                        {status.ssmaSubscriptions}
                      </Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" fontWeight="semibold">Pending Subscription Imports:</Text>
                      <Badge tone={status.pendingSubscriptions > 0 ? "warning" : "success"}>
                        {status.pendingSubscriptions}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Migration Options */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Migration Options</Text>

              <Checkbox
                label="Import Orders"
                helpText="Import unfulfilled/active orders into SSMA's pickup schedule"
                checked={importOrders}
                onChange={setImportOrders}
              />

              <Checkbox
                label="Import Subscriptions"
                helpText="Import active subscription contracts into SSMA's subscription management"
                checked={importSubscriptions}
                onChange={setImportSubscriptions}
              />

              <Checkbox
                label="Create Google Calendar Events"
                helpText="Create calendar events for imported orders (if Google Calendar is connected)"
                checked={createCalendarEvents}
                onChange={setCreateCalendarEvents}
              />

              <TextField
                label="Orders: Days to look back"
                type="number"
                value={ordersDaysBack}
                onChange={setOrdersDaysBack}
                helpText="Import orders created within this many days"
                autoComplete="off"
              />

              <Divider />

              <Checkbox
                label="Dry Run (Preview Only)"
                helpText="Show what would be imported without actually making changes"
                checked={dryRun}
                onChange={setDryRun}
              />

              <InlineStack gap="300">
                <Button
                  variant="primary"
                  onClick={handleRunMigration}
                  loading={isLoading}
                  disabled={!importOrders && !importSubscriptions}
                >
                  {dryRun ? "Preview Migration" : "Run Migration"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Migration Results */}
        {actionData && "result" in actionData && actionData.result && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {actionData.result.dryRun ? "Preview Results" : "Migration Results"}
                  </Text>
                  <Badge tone={actionData.success ? "success" : "critical"}>
                    {actionData.success ? "Completed" : "Failed"}
                  </Badge>
                </InlineStack>

                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span">Orders Imported:</Text>
                      <Text as="span" fontWeight="semibold">{actionData.result.ordersImported}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span">Orders Skipped:</Text>
                      <Text as="span">{actionData.result.ordersSkipped}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span">Subscriptions Imported:</Text>
                      <Text as="span" fontWeight="semibold">{actionData.result.subscriptionsImported}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span">Subscriptions Skipped:</Text>
                      <Text as="span">{actionData.result.subscriptionsSkipped}</Text>
                    </InlineStack>
                  </BlockStack>
                </Box>

                {/* Order Details */}
                {actionData.result.details.orders.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">Order Details</Text>
                    <Box maxHeight="300px" overflowY="auto">
                      <List type="bullet">
                        {actionData.result.details.orders.map((order: any) => (
                          <List.Item key={order.id}>
                            <InlineStack gap="200">
                              <Text as="span" fontWeight="semibold">{order.name}</Text>
                              <Badge tone={order.status === "imported" ? "success" : "info"}>
                                {order.status}
                              </Badge>
                              {order.reason && (
                                <Text as="span" tone="subdued">({order.reason})</Text>
                              )}
                            </InlineStack>
                          </List.Item>
                        ))}
                      </List>
                    </Box>
                  </BlockStack>
                )}

                {/* Subscription Details */}
                {actionData.result.details.subscriptions.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">Subscription Details</Text>
                    <Box maxHeight="300px" overflowY="auto">
                      <List type="bullet">
                        {actionData.result.details.subscriptions.map((sub: any) => (
                          <List.Item key={sub.id}>
                            <InlineStack gap="200">
                              <Text as="span" fontWeight="semibold">{sub.customer}</Text>
                              <Badge tone={sub.status === "imported" ? "success" : "info"}>
                                {sub.status}
                              </Badge>
                              {sub.reason && (
                                <Text as="span" tone="subdued">({sub.reason})</Text>
                              )}
                            </InlineStack>
                          </List.Item>
                        ))}
                      </List>
                    </Box>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Instructions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Migration Steps</Text>
              <List type="number">
                <List.Item>
                  <strong>Before Migration:</strong> Ensure the TEST theme with SSMA is published
                  and you've verified basic checkout flow works.
                </List.Item>
                <List.Item>
                  <strong>Preview First:</strong> Always run with "Dry Run" enabled first to see
                  what will be imported without making changes.
                </List.Item>
                <List.Item>
                  <strong>Run Migration:</strong> Uncheck "Dry Run" and run the actual migration
                  to import orders and subscriptions.
                </List.Item>
                <List.Item>
                  <strong>Verify:</strong> Check the Orders, Subscriptions, and Calendar pages
                  to ensure data imported correctly.
                </List.Item>
                <List.Item>
                  <strong>Google Calendar:</strong> If connected, calendar events will be created
                  for each imported order.
                </List.Item>
              </List>

              <Banner tone="info">
                <p>
                  <strong>Note:</strong> Orders and subscriptions that already exist in SSMA
                  will be skipped (no duplicates). You can safely run this multiple times.
                </p>
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
