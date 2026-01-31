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
  DataTable,
  Spinner,
  Box,
  Divider,
  TextField,
  FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import {
  ensureSellingPlanGroup,
  getSellingPlanConfig,
  addProductsToSellingPlanGroup,
} from "../services/selling-plans.server";
import {
  getFailedBillings,
  getUpcomingBillings,
  retryBilling,
} from "../services/subscription-billing.server";
import { formatDatePacific } from "../utils/timezone.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Get selling plan configuration
  const sellingPlanConfig = await getSellingPlanConfig(shop);

  // Get failed billings
  const failedBillingsRaw = await getFailedBillings(shop);

  // Get upcoming billings (next 7 days)
  const upcomingBillingsRaw = await getUpcomingBillings(shop, 7);

  // Format dates on the server side to avoid importing server-only modules in client code
  const failedBillings = failedBillingsRaw.map((sub) => ({
    ...sub,
    lastBillingAttemptAtFormatted: sub.lastBillingAttemptAt
      ? new Date(sub.lastBillingAttemptAt).toLocaleDateString()
      : "-",
  }));

  const upcomingBillings = upcomingBillingsRaw.map((sub) => ({
    ...sub,
    nextBillingDateFormatted: sub.nextBillingDate
      ? formatDatePacific(new Date(sub.nextBillingDate), {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "-",
    nextPickupDateFormatted: sub.nextPickupDate
      ? formatDatePacific(new Date(sub.nextPickupDate), {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "-",
  }));

  // Build customer subscription management URL
  const customerPortalUrl = `https://${shop}/apps/my-subscription`;

  return json({
    shop,
    sellingPlanConfig,
    failedBillings,
    upcomingBillings,
    customerPortalUrl,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "create_selling_plans": {
        const config = await ensureSellingPlanGroup(shop, admin);
        return json({
          success: true,
          message: "Selling plan group created successfully",
          config,
        });
      }

      case "add_products": {
        const productIdsStr = formData.get("productIds") as string;
        if (!productIdsStr) {
          return json({ error: "No product IDs provided" }, { status: 400 });
        }
        const productIds = productIdsStr.split(",").map((id) => id.trim());
        await addProductsToSellingPlanGroup(shop, admin, productIds);
        return json({
          success: true,
          message: `Added ${productIds.length} product(s) to Subscribe & Save`,
        });
      }

      case "retry_billing": {
        const subscriptionId = formData.get("subscriptionId") as string;
        if (!subscriptionId) {
          return json({ error: "No subscription ID provided" }, { status: 400 });
        }
        await retryBilling(shop, admin, subscriptionId);
        return json({
          success: true,
          message: "Billing retry initiated",
        });
      }

      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: String(error) }, { status: 500 });
  }
};

export default function SubscriptionsSettings() {
  const { sellingPlanConfig, failedBillings, upcomingBillings, customerPortalUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const [productIds, setProductIds] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(customerPortalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [customerPortalUrl]);

  const handleCreateSellingPlans = () => {
    submit({ intent: "create_selling_plans" }, { method: "post" });
  };

  const handleAddProducts = () => {
    if (!productIds.trim()) return;
    submit({ intent: "add_products", productIds }, { method: "post" });
    setProductIds("");
  };

  const handleRetryBilling = (subscriptionId: string) => {
    submit({ intent: "retry_billing", subscriptionId }, { method: "post" });
  };

  // Format failed billings for data table
  const failedBillingsRows = failedBillings.map((sub) => [
    sub.customerName,
    sub.customerEmail || "-",
    sub.frequency,
    sub.billingFailureCount.toString(),
    sub.billingFailureReason || "Unknown error",
    sub.lastBillingAttemptAtFormatted,
    <Button
      key={sub.id}
      size="slim"
      onClick={() => handleRetryBilling(sub.id)}
      loading={isLoading}
    >
      Retry
    </Button>,
  ]);

  // Format upcoming billings for data table
  const upcomingBillingsRows = upcomingBillings.map((sub) => [
    sub.customerName,
    sub.frequency,
    sub.nextBillingDateFormatted,
    sub.nextPickupDateFormatted,
    <Badge key={sub.id} tone="success">
      Active
    </Badge>,
  ]);

  return (
    <Page>
      <TitleBar title="Subscription Settings" />
      <Layout>
        {/* Success/Error Messages */}
        {actionData && "success" in actionData && actionData.success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => {}}>
              {actionData.message}
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

        {/* Selling Plan Configuration */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Selling Plans
                </Text>
                {sellingPlanConfig ? (
                  <Badge tone="success">Configured</Badge>
                ) : (
                  <Badge tone="attention">Not Configured</Badge>
                )}
              </InlineStack>

              <Text as="p" tone="subdued">
                Selling plans enable subscription purchases on your products. Once
                created, you can add products to the Subscribe & Save plan group.
              </Text>

              {sellingPlanConfig ? (
                <BlockStack gap="200">
                  <Text as="p">
                    <strong>Group ID:</strong> {sellingPlanConfig.groupId}
                  </Text>
                  <InlineStack gap="400">
                    <Text as="p">
                      Weekly: <Badge>{`${sellingPlanConfig.weeklyDiscount}% off`}</Badge>
                    </Text>
                    <Text as="p">
                      Bi-weekly: <Badge>{`${sellingPlanConfig.biweeklyDiscount}% off`}</Badge>
                    </Text>
                  </InlineStack>
                </BlockStack>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleCreateSellingPlans}
                  loading={isLoading}
                >
                  Create Selling Plans
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Add Products to Selling Plan Group */}
        {sellingPlanConfig && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Add Products to Subscribe & Save
                </Text>
                <Text as="p" tone="subdued">
                  Enter Shopify Product IDs (GIDs) to add them to the Subscribe & Save
                  selling plan group. Separate multiple IDs with commas.
                </Text>
                <FormLayout>
                  <TextField
                    label="Product IDs"
                    value={productIds}
                    onChange={setProductIds}
                    placeholder="gid://shopify/Product/123456789, gid://shopify/Product/987654321"
                    autoComplete="off"
                    helpText="Find Product IDs in your Shopify admin URL or via the API"
                  />
                  <Button
                    onClick={handleAddProducts}
                    disabled={!productIds.trim()}
                    loading={isLoading}
                  >
                    Add Products
                  </Button>
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Customer Subscription Management URL */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Customer Subscription Management URL
              </Text>
              <Text as="p" tone="subdued">
                Add this URL to your store's navigation so customers can manage their subscriptions.
                The best place is in the Account menu or Footer navigation.
              </Text>
              <Box
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodyMd" breakWord>
                    {customerPortalUrl}
                  </Text>
                  <Button
                    onClick={handleCopyUrl}
                    size="slim"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </InlineStack>
              </Box>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  How to add to your store:
                </Text>
                <Text as="p" variant="bodySm">
                  1. Go to <strong>Online Store → Navigation</strong> in your Shopify admin
                </Text>
                <Text as="p" variant="bodySm">
                  2. Edit your <strong>Account menu</strong> or <strong>Footer menu</strong>
                </Text>
                <Text as="p" variant="bodySm">
                  3. Add a new menu item with name "Manage Subscription" and link <code>/apps/my-subscription</code>
                </Text>
              </BlockStack>
              <Banner tone="info">
                Customers must be logged in to view their subscriptions. The portal will prompt them to log in if they're not.
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* Billing Information */}
        <Layout.Section>
          <Text as="h2" variant="headingLg">
            Billing Management
          </Text>
          <Text as="p" tone="subdued">
            Subscriptions are billed 84 hours (3.5 days) before the scheduled pickup time.
          </Text>
        </Layout.Section>

        {/* Failed Billings */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Failed Billings
                </Text>
                {failedBillings.length > 0 && (
                  <Badge tone="critical">{failedBillings.length.toString()}</Badge>
                )}
              </InlineStack>

              {failedBillings.length === 0 ? (
                <Text as="p" tone="subdued">
                  No failed billings. All subscriptions are billing successfully.
                </Text>
              ) : (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "numeric",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "Customer",
                    "Email",
                    "Frequency",
                    "Failures",
                    "Reason",
                    "Last Attempt",
                    "Action",
                  ]}
                  rows={failedBillingsRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Upcoming Billings */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Upcoming Billings (Next 7 Days)
                </Text>
                <Badge>{upcomingBillings.length.toString()}</Badge>
              </InlineStack>

              {upcomingBillings.length === 0 ? (
                <Text as="p" tone="subdued">
                  No upcoming billings in the next 7 days.
                </Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={[
                    "Customer",
                    "Frequency",
                    "Billing Date",
                    "Pickup Date",
                    "Status",
                  ]}
                  rows={upcomingBillingsRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Billing Schedule Explanation */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                How Billing Works
              </Text>
              <BlockStack gap="200">
                <Text as="p">
                  <strong>1. Initial Purchase:</strong> Customer is charged at checkout
                  for their first delivery.
                </Text>
                <Text as="p">
                  <strong>2. Recurring Billing:</strong> For subsequent deliveries,
                  customers are automatically charged 84 hours (3.5 days) before their
                  scheduled pickup time.
                </Text>
                <Text as="p">
                  <strong>3. Example:</strong> If a customer has a Saturday 12:00 PM
                  pickup, they will be billed Tuesday around midnight (84 hours before).
                </Text>
                <Text as="p">
                  <strong>4. Failures:</strong> If billing fails, we retry up to 3 times.
                  After 3 failures, the subscription is automatically paused.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
