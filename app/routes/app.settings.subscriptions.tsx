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
  Box,
  Divider,
  TextField,
  FormLayout,
  Modal,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import {
  ensureSellingPlanGroup,
  getSellingPlanConfig,
  addProductsToSellingPlanGroup,
  getAllSellingPlanGroups,
  addSellingPlanToGroup,
  deleteSellingPlan,
} from "../services/selling-plans.server";
import type { SellingPlanGroupDetail } from "../types/selling-plans";
import { formatFrequency } from "../utils/formatting";
import {
  getFailedBillings,
  getUpcomingBillings,
  retryBilling,
} from "../services/subscription-billing.server";
import { formatDatePacific } from "../utils/timezone.server";
import { createSubscriptionFromContract } from "../services/subscription.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Get selling plan configuration from our database
  const sellingPlanConfig = await getSellingPlanConfig(shop);
  console.log("Selling plan config from database:", sellingPlanConfig);

  // Get ALL selling plan groups from Shopify (includes plans created outside our app)
  let sellingPlanGroups = await getAllSellingPlanGroups(admin);
  console.log("Selling plan groups from Shopify:", sellingPlanGroups.length, "groups found");

  // If Shopify returns no groups but we have a local config, create a synthetic entry
  // This handles the case where we can CREATE selling plans but can't READ them back
  // (possibly due to eventual consistency or permission quirks)
  let usingLocalConfig = false;
  if (sellingPlanGroups.length === 0 && sellingPlanConfig) {
    console.log("No groups from Shopify but local config exists, using local config");
    usingLocalConfig = true;

    // Build plans array from default plans + additional plans
    const plans = [
      ...(sellingPlanConfig.weeklyPlanId ? [{
        id: sellingPlanConfig.weeklyPlanId,
        name: `Deliver every week (${sellingPlanConfig.weeklyDiscount}% off)`,
        interval: "WEEK",
        intervalCount: 1,
        discount: sellingPlanConfig.weeklyDiscount,
        discountType: "PERCENTAGE",
        productCount: 0,
      }] : []),
      ...(sellingPlanConfig.biweeklyPlanId ? [{
        id: sellingPlanConfig.biweeklyPlanId,
        name: `Deliver every 2 weeks (${sellingPlanConfig.biweeklyDiscount}% off)`,
        interval: "WEEK",
        intervalCount: 2,
        discount: sellingPlanConfig.biweeklyDiscount,
        discountType: "PERCENTAGE",
        productCount: 0,
      }] : []),
      // Include additional plans from database
      ...(sellingPlanConfig.additionalPlans || []).map((plan) => ({
        id: plan.shopifyPlanId,
        name: plan.name,
        interval: plan.interval,
        intervalCount: plan.intervalCount,
        discount: plan.discount,
        discountType: plan.discountType,
        productCount: 0,
      })),
    ];

    sellingPlanGroups = [{
      id: sellingPlanConfig.groupId,
      name: sellingPlanConfig.groupName || "Subscribe & Save",
      productCount: 0, // Unknown without API access
      plans,
    }];
  }

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
    sellingPlanGroups,
    usingLocalConfig,
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

      case "add_selling_plan": {
        const groupId = formData.get("groupId") as string;
        const planName = formData.get("planName") as string;
        const intervalCount = parseInt(formData.get("intervalCount") as string, 10);
        const discountPercent = parseFloat(formData.get("discountPercent") as string);
        const interval = (formData.get("interval") as string) || "WEEK";

        if (!groupId || !planName || isNaN(intervalCount) || isNaN(discountPercent)) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const result = await addSellingPlanToGroup(
          admin,
          shop,
          groupId,
          planName,
          intervalCount,
          discountPercent,
          interval
        );

        if (!result.success) {
          return json({ error: result.error }, { status: 400 });
        }

        return json({
          success: true,
          message: `Created new plan: ${planName}`,
        });
      }

      case "delete_selling_plan": {
        const groupId = formData.get("groupId") as string;
        const planId = formData.get("planId") as string;

        if (!groupId || !planId) {
          return json({ error: "Missing group or plan ID" }, { status: 400 });
        }

        const result = await deleteSellingPlan(admin, shop, groupId, planId);

        if (!result.success) {
          return json({ error: result.error }, { status: 400 });
        }

        return json({
          success: true,
          message: "Selling plan deleted",
        });
      }

      case "manual_sync_contract": {
        const orderInput = formData.get("contractId") as string;

        if (!orderInput) {
          return json({ error: "No order number or contract ID provided" }, { status: 400 });
        }

        let contract: {
          id: string;
          status: string;
          customer: { id: string; email: string; firstName: string; lastName: string; phone: string | null } | null;
          billingPolicy: { interval: string; intervalCount: number };
          deliveryPolicy: { interval: string; intervalCount: number };
        } | null = null;

        // Check if it's a contract GID or an order number/name
        if (orderInput.startsWith("gid://shopify/SubscriptionContract/")) {
          // Direct contract ID lookup
          const response = await admin.graphql(`
            query getSubscriptionContract($id: ID!) {
              subscriptionContract(id: $id) {
                id
                status
                customer {
                  id
                  email
                  firstName
                  lastName
                  phone
                }
                billingPolicy {
                  interval
                  intervalCount
                }
                deliveryPolicy {
                  interval
                  intervalCount
                }
              }
            }
          `, {
            variables: { id: orderInput },
          });

          const data = await response.json();
          contract = data.data?.subscriptionContract;
        } else {
          // Assume it's an order number - look up the order first
          // Clean up the input - remove # if present
          const orderName = orderInput.replace(/^#/, "");

          // Find the order by name
          const orderResponse = await admin.graphql(`
            query getOrderByName($query: String!) {
              orders(first: 1, query: $query) {
                nodes {
                  id
                  name
                  lineItems(first: 10) {
                    nodes {
                      sellingPlan {
                        sellingPlanId
                      }
                    }
                  }
                }
              }
            }
          `, {
            variables: { query: `name:${orderName}` },
          });

          const orderData = await orderResponse.json();
          const order = orderData.data?.orders?.nodes?.[0];

          if (!order) {
            return json({ error: `Order "${orderInput}" not found` }, { status: 404 });
          }

          // Check if this order has a selling plan (subscription)
          const hasSellingPlan = order.lineItems?.nodes?.some((item: { sellingPlan: { sellingPlanId: string } | null }) => item.sellingPlan?.sellingPlanId);

          if (!hasSellingPlan) {
            return json({ error: `Order "${orderInput}" is not a subscription order` }, { status: 400 });
          }

          // Now get the subscription contracts and find one associated with this customer/order
          // We'll search for recent contracts created around the same time
          const contractsResponse = await admin.graphql(`
            query getRecentContracts {
              subscriptionContracts(first: 50, reverse: true) {
                nodes {
                  id
                  status
                  createdAt
                  customer {
                    id
                    email
                    firstName
                    lastName
                    phone
                  }
                  billingPolicy {
                    interval
                    intervalCount
                  }
                  deliveryPolicy {
                    interval
                    intervalCount
                  }
                  originOrder {
                    id
                  }
                }
              }
            }
          `);

          const contractsData = await contractsResponse.json();
          const contracts = contractsData.data?.subscriptionContracts?.nodes || [];

          // Find contract matching the order
          contract = contracts.find((c: { originOrder?: { id: string } }) => c.originOrder?.id === order.id);

          if (!contract) {
            return json({
              error: `Could not find subscription contract for order "${orderInput}". The contract may have been created by a different app.`,
            }, { status: 404 });
          }
        }

        if (!contract) {
          return json({ error: "Subscription contract not found. Make sure the ID is correct and the contract was created by this app." }, { status: 404 });
        }

        // Check if already synced
        const existingSubscription = await prisma.subscriptionPickup.findFirst({
          where: {
            shop,
            shopifyContractId: contract.id,
          },
        });

        if (existingSubscription) {
          return json({ error: "This subscription contract has already been synced" }, { status: 400 });
        }

        // Extract customer info
        const customerName = `${contract.customer?.firstName || ""} ${contract.customer?.lastName || ""}`.trim() || "Unknown Customer";
        const customerEmail = contract.customer?.email || null;
        const customerPhone = contract.customer?.phone || null;

        // Determine frequency from billing policy
        let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";
        switch (contract.billingPolicy.intervalCount) {
          case 1:
            frequency = "WEEKLY";
            break;
          case 2:
            frequency = "BIWEEKLY";
            break;
          case 3:
            frequency = "TRIWEEKLY";
            break;
          default:
            frequency = "WEEKLY";
        }

        // Default pickup settings (can be adjusted later by customer)
        const preferredDay = 2; // Tuesday
        const preferredTimeSlot = "12:00 PM - 2:00 PM";

        // Create the subscription
        const subscriptionId = await createSubscriptionFromContract(
          shop,
          contract.id,
          customerName,
          customerEmail,
          customerPhone,
          frequency,
          preferredDay,
          preferredTimeSlot
        );

        return json({
          success: true,
          message: `Successfully synced subscription for ${customerName}`,
          subscriptionId,
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
  const { sellingPlanConfig, sellingPlanGroups, usingLocalConfig, failedBillings, upcomingBillings, customerPortalUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const [productIds, setProductIds] = useState("");
  const [copied, setCopied] = useState(false);

  // Add Plan Modal State
  const [addPlanModalOpen, setAddPlanModalOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanInterval, setNewPlanInterval] = useState("WEEK");
  const [newPlanIntervalCount, setNewPlanIntervalCount] = useState("1");
  const [newPlanDiscount, setNewPlanDiscount] = useState("5");

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<{ groupId: string; planId: string; name: string } | null>(null);

  // Manual sync state
  const [contractId, setContractId] = useState("");

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

  const handleOpenAddPlanModal = (groupId: string) => {
    setSelectedGroupId(groupId);
    setNewPlanName("");
    setNewPlanInterval("WEEK");
    setNewPlanIntervalCount("1");
    setNewPlanDiscount("5");
    setAddPlanModalOpen(true);
  };

  const handleAddPlan = () => {
    const intervalCount = parseInt(newPlanIntervalCount, 10);
    const discount = parseFloat(newPlanDiscount);

    // Generate plan name if not provided
    const planName = newPlanName ||
      `Deliver ${formatFrequency(newPlanInterval, intervalCount)} (${discount}% off)`;

    submit({
      intent: "add_selling_plan",
      groupId: selectedGroupId,
      planName,
      interval: newPlanInterval,
      intervalCount: newPlanIntervalCount,
      discountPercent: newPlanDiscount,
    }, { method: "post" });

    setAddPlanModalOpen(false);
  };

  const handleDeletePlan = (groupId: string, planId: string, name: string) => {
    setPlanToDelete({ groupId, planId, name });
    setDeleteConfirmOpen(true);
  };

  const confirmDeletePlan = () => {
    if (planToDelete) {
      submit({
        intent: "delete_selling_plan",
        groupId: planToDelete.groupId,
        planId: planToDelete.planId,
      }, { method: "post" });
    }
    setDeleteConfirmOpen(false);
    setPlanToDelete(null);
  };

  const handleManualSync = () => {
    if (!contractId.trim()) return;
    submit({ intent: "manual_sync_contract", contractId: contractId.trim() }, { method: "post" });
    setContractId("");
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

        {/* Subscription Plans from Shopify */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Subscription Plans
                </Text>
                {sellingPlanGroups.length > 0 ? (
                  <Badge tone="success">{sellingPlanGroups.length} group(s)</Badge>
                ) : (
                  <Badge tone="attention">Not Configured</Badge>
                )}
              </InlineStack>

              <Text as="p" tone="subdued">
                Manage your subscription plans. These plans are synced from Shopify and
                determine the frequency and discount options available to customers.
              </Text>

              {usingLocalConfig && (
                <Banner tone="info">
                  Showing locally stored configuration. The selling plan group exists in Shopify
                  but may not be fully synced. Your subscription plans are working correctly.
                </Banner>
              )}

              {sellingPlanGroups.length === 0 ? (
                <BlockStack gap="300">
                  <Banner tone="warning">
                    No selling plan groups found. Create one to enable subscriptions.
                  </Banner>
                  <Button
                    variant="primary"
                    onClick={handleCreateSellingPlans}
                    loading={isLoading}
                  >
                    Create Subscribe & Save Plans
                  </Button>
                </BlockStack>
              ) : (
                <BlockStack gap="400">
                  {sellingPlanGroups.map((group: SellingPlanGroupDetail) => (
                    <Box
                      key={group.id}
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingSm">
                              {group.name}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {group.productCount} product(s)
                            </Text>
                          </BlockStack>
                          <Button
                            size="slim"
                            onClick={() => handleOpenAddPlanModal(group.id)}
                          >
                            Add Plan
                          </Button>
                        </InlineStack>

                        <Divider />

                        {group.plans.length === 0 ? (
                          <Text as="p" tone="subdued">
                            No plans in this group.
                          </Text>
                        ) : (
                          <DataTable
                            columnContentTypes={["text", "text", "numeric", "text"]}
                            headings={["Plan Name", "Frequency", "Discount", "Actions"]}
                            rows={group.plans.map((plan) => [
                              plan.name,
                              formatFrequency(plan.interval, plan.intervalCount),
                              plan.discountType === "PERCENTAGE"
                                ? `${plan.discount}% off`
                                : `$${plan.discount} off`,
                              <Button
                                key={plan.id}
                                size="slim"
                                tone="critical"
                                onClick={() => handleDeletePlan(group.id, plan.id, plan.name)}
                              >
                                Delete
                              </Button>,
                            ])}
                          />
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
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

        {/* Manual Subscription Sync */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Manual Subscription Sync
              </Text>
              <Text as="p" tone="subdued">
                If a subscription wasn't captured automatically, you can manually sync it by entering
                the order confirmation number (e.g., #GGNVHWWKP) from the subscription order.
              </Text>
              <FormLayout>
                <TextField
                  label="Order Number"
                  value={contractId}
                  onChange={setContractId}
                  placeholder="#GGNVHWWKP or GGNVHWWKP"
                  autoComplete="off"
                  helpText="The order confirmation number from the subscription order"
                />
                <Button
                  onClick={handleManualSync}
                  disabled={!contractId.trim()}
                  loading={isLoading}
                >
                  Sync Subscription
                </Button>
              </FormLayout>
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

      {/* Add Plan Modal */}
      <Modal
        open={addPlanModalOpen}
        onClose={() => setAddPlanModalOpen(false)}
        title="Add New Subscription Plan"
        primaryAction={{
          content: "Create Plan",
          onAction: handleAddPlan,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setAddPlanModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Plan Name (optional)"
              value={newPlanName}
              onChange={setNewPlanName}
              placeholder="e.g., Deliver every 3 weeks (2.5% off)"
              autoComplete="off"
              helpText="Leave blank to auto-generate based on frequency and discount"
            />
            <Select
              label="Billing Interval"
              options={[
                { label: "Week(s)", value: "WEEK" },
                { label: "Month(s)", value: "MONTH" },
              ]}
              value={newPlanInterval}
              onChange={setNewPlanInterval}
            />
            <TextField
              label="Interval Count"
              type="number"
              value={newPlanIntervalCount}
              onChange={setNewPlanIntervalCount}
              min={1}
              max={52}
              autoComplete="off"
              helpText={`Customer will be billed every ${newPlanIntervalCount} ${newPlanInterval.toLowerCase()}(s)`}
            />
            <TextField
              label="Discount Percentage"
              type="number"
              value={newPlanDiscount}
              onChange={setNewPlanDiscount}
              min={0}
              max={100}
              suffix="%"
              autoComplete="off"
              helpText="Percentage discount applied to subscription orders"
            />
            <Banner tone="info">
              Preview: {newPlanName || `Deliver ${formatFrequency(newPlanInterval, parseInt(newPlanIntervalCount, 10) || 1)} (${newPlanDiscount}% off)`}
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Subscription Plan"
        primaryAction={{
          content: "Delete Plan",
          destructive: true,
          onAction: confirmDeletePlan,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteConfirmOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Are you sure you want to delete the plan <strong>"{planToDelete?.name}"</strong>?
            </Text>
            <Banner tone="warning">
              Existing subscribers on this plan may be affected. Make sure to migrate them to a different plan first.
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
