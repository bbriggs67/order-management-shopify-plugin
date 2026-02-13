import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation, useSearchParams, useNavigate } from "@remix-run/react";
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
  Checkbox,
  Box,
  Divider,
  Select,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscriptionFromContract } from "../services/subscription.server";

// Type for the admin GraphQL client
interface AdminClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

// GraphQL query to fetch all subscription contracts from Shopify
const SUBSCRIPTION_CONTRACTS_QUERY = `
  query getSubscriptionContracts($first: Int!, $after: String, $query: String) {
    subscriptionContracts(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          status
          createdAt
          nextBillingDate
          customer {
            id
            email
            displayName
            firstName
            lastName
            phone
          }
          deliveryPolicy {
            interval
            intervalCount
          }
          billingPolicy {
            interval
            intervalCount
          }
          lines(first: 10) {
            edges {
              node {
                title
                quantity
                currentPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface ShopifyContract {
  id: string;
  status: string;
  createdAt: string;
  nextBillingDate: string | null;
  customer: {
    id: string;
    email: string | null;
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  };
  deliveryPolicy: {
    interval: string;
    intervalCount: number;
  };
  billingPolicy: {
    interval: string;
    intervalCount: number;
  };
  lines: {
    edges: Array<{
      node: {
        title: string;
        quantity: number;
        currentPrice: {
          amount: string;
          currencyCode: string;
        };
      };
    }>;
  };
}

interface ContractForDisplay {
  id: string;
  status: string;
  createdAt: string;
  nextBillingDate: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  frequency: string;
  intervalCount: number;
  products: string;
  totalAmount: string;
  alreadySynced: boolean;
}

async function fetchAllContracts(
  admin: AdminClient
): Promise<ShopifyContract[]> {
  const contracts: ShopifyContract[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  // Note: Status filter in query param requires API version 2025-04+
  // We're on 2024-10, so we fetch all and filter client-side
  console.log("Fetching all subscription contracts from Shopify...");

  while (hasNextPage) {
    const variables: Record<string, unknown> = {
      first: 50,
      after: cursor,
      query: null, // Don't use query filter - not supported in 2024-10
    };

    const response = await admin.graphql(SUBSCRIPTION_CONTRACTS_QUERY, {
      variables,
    });

    const jsonResponse = await response.json();

    if (jsonResponse.errors) {
      console.error("GraphQL errors fetching subscription contracts:", jsonResponse.errors);
      // Continue anyway to try to get partial data
    }

    const data = jsonResponse.data?.subscriptionContracts;

    if (!data) {
      console.error("Failed to fetch subscription contracts - no data returned");
      console.error("Response:", JSON.stringify(jsonResponse, null, 2).substring(0, 1000));
      break;
    }

    console.log(`Fetched ${data.edges?.length || 0} contracts in this batch`);

    for (const edge of data.edges || []) {
      contracts.push(edge.node);
    }

    hasNextPage = data.pageInfo?.hasNextPage || false;
    cursor = data.pageInfo?.endCursor || null;
  }

  console.log(`Total contracts fetched: ${contracts.length}`);
  return contracts;
}

function getFrequencyFromInterval(interval: string, intervalCount: number): "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY" {
  if (interval === "WEEK") {
    switch (intervalCount) {
      case 1:
        return "WEEKLY";
      case 2:
        return "BIWEEKLY";
      case 3:
        return "TRIWEEKLY";
      default:
        return "WEEKLY";
    }
  }
  // Default for non-weekly intervals
  return "WEEKLY";
}

function formatFrequencyDisplay(interval: string, intervalCount: number): string {
  if (interval === "WEEK") {
    switch (intervalCount) {
      case 1:
        return "Weekly";
      case 2:
        return "Bi-weekly";
      case 3:
        return "Tri-weekly";
      default:
        return `Every ${intervalCount} weeks`;
    }
  }
  return `Every ${intervalCount} ${interval.toLowerCase()}(s)`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Get URL params for filtering
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "ACTIVE";

  // Fetch ALL contracts from Shopify (API 2024-10 doesn't support status filter in query)
  const allContracts = await fetchAllContracts(admin);

  // Filter client-side by status
  const shopifyContracts = statusFilter
    ? allContracts.filter((c) => c.status === statusFilter)
    : allContracts;

  console.log(`Filtered to ${shopifyContracts.length} contracts with status: ${statusFilter || 'ALL'}`);

  // Get existing synced contract IDs from our database
  const existingSubscriptions = await prisma.subscriptionPickup.findMany({
    where: { shop },
    select: { shopifyContractId: true },
  });
  const syncedContractIds = new Set(existingSubscriptions.map((s) => s.shopifyContractId));

  // Transform contracts for display
  const contractsForDisplay: ContractForDisplay[] = shopifyContracts.map((contract) => {
    const products = contract.lines.edges
      .map((edge) => `${edge.node.title} (x${edge.node.quantity})`)
      .join(", ");

    const totalAmount = contract.lines.edges.reduce((sum, edge) => {
      return sum + parseFloat(edge.node.currentPrice.amount) * edge.node.quantity;
    }, 0);

    const customerName = contract.customer.displayName ||
      `${contract.customer.firstName || ""} ${contract.customer.lastName || ""}`.trim() ||
      "Unknown";

    return {
      id: contract.id,
      status: contract.status,
      createdAt: contract.createdAt,
      nextBillingDate: contract.nextBillingDate,
      customerName,
      customerEmail: contract.customer.email,
      customerPhone: contract.customer.phone,
      frequency: formatFrequencyDisplay(
        contract.billingPolicy.interval,
        contract.billingPolicy.intervalCount
      ),
      intervalCount: contract.billingPolicy.intervalCount,
      products: products || "No products",
      totalAmount: `$${totalAmount.toFixed(2)}`,
      alreadySynced: syncedContractIds.has(contract.id),
    };
  });

  return json({
    shop,
    contracts: contractsForDisplay,
    statusFilter,
    totalCount: contractsForDisplay.length,
    syncedCount: contractsForDisplay.filter((c) => c.alreadySynced).length,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "sync_selected": {
        const contractIdsStr = formData.get("contractIds") as string;
        if (!contractIdsStr) {
          return json({ error: "No contracts selected" }, { status: 400 });
        }

        const contractIds = JSON.parse(contractIdsStr) as string[];
        let synced = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const contractId of contractIds) {
          // Check if already synced
          const existing = await prisma.subscriptionPickup.findFirst({
            where: { shop, shopifyContractId: contractId },
          });

          if (existing) {
            skipped++;
            continue;
          }

          // Fetch full contract details from Shopify
          const response = await admin.graphql(SUBSCRIPTION_CONTRACTS_QUERY.replace("$first: Int!, $after: String, $query: String", "$first: Int!").replace("first: $first, after: $after, query: $query", "first: 1, query: \"id:" + contractId.replace("gid://shopify/SubscriptionContract/", "") + "\""), {
            variables: { first: 1 },
          });

          // Use a simpler approach - fetch the specific contract
          const detailQuery = `
            query getContract($id: ID!) {
              subscriptionContract(id: $id) {
                id
                status
                customer {
                  email
                  firstName
                  lastName
                  phone
                }
                billingPolicy {
                  interval
                  intervalCount
                }
              }
            }
          `;

          const detailResponse = await admin.graphql(detailQuery, {
            variables: { id: contractId },
          });

          const detailJson = await detailResponse.json();
          const contract = detailJson.data?.subscriptionContract;

          if (!contract) {
            errors.push(`Contract ${contractId} not found`);
            continue;
          }

          // Extract customer info
          const customerName = `${contract.customer.firstName || ""} ${contract.customer.lastName || ""}`.trim() || "Unknown Customer";
          const customerEmail = contract.customer.email || null;
          const customerPhone = contract.customer.phone || null;

          // Determine frequency
          const frequency = getFrequencyFromInterval(
            contract.billingPolicy.interval,
            contract.billingPolicy.intervalCount
          );

          // Default preferred day to Tuesday (2) and time slot
          const preferredDay = 2;
          const preferredTimeSlot = "12:00 PM - 2:00 PM";

          try {
            await createSubscriptionFromContract(
              shop,
              contractId,
              customerName,
              customerEmail,
              customerPhone,
              frequency,
              preferredDay,
              preferredTimeSlot
            );
            synced++;
          } catch (err) {
            errors.push(`Failed to sync ${contractId}: ${err}`);
          }
        }

        return json({
          success: true,
          message: `Synced ${synced} subscription(s). ${skipped > 0 ? `Skipped ${skipped} already synced.` : ""} ${errors.length > 0 ? `Errors: ${errors.length}` : ""}`,
          synced,
          skipped,
          errors,
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

export default function LegacySubscriptionManagement() {
  const { contracts, statusFilter, totalCount, syncedCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isLoading = navigation.state !== "idle";

  const [selectedContracts, setSelectedContracts] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState(statusFilter);

  const handleStatusFilterChange = useCallback((value: string) => {
    setFilterStatus(value);
    setSelectedContracts(new Set());
    // Use Remix navigate to stay within embedded app context
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    navigate(`/app/settings/sync-subscriptions?${params.toString()}`);
  }, [navigate]);

  const handleSelectAll = useCallback(() => {
    const unsyncedContracts = contracts.filter((c) => !c.alreadySynced);
    if (selectedContracts.size === unsyncedContracts.length) {
      setSelectedContracts(new Set());
    } else {
      setSelectedContracts(new Set(unsyncedContracts.map((c) => c.id)));
    }
  }, [contracts, selectedContracts]);

  const handleSelectContract = useCallback((contractId: string) => {
    setSelectedContracts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(contractId)) {
        newSet.delete(contractId);
      } else {
        newSet.add(contractId);
      }
      return newSet;
    });
  }, []);

  const handleSyncSelected = useCallback(() => {
    if (selectedContracts.size === 0) return;
    submit(
      {
        intent: "sync_selected",
        contractIds: JSON.stringify(Array.from(selectedContracts)),
      },
      { method: "post" }
    );
  }, [selectedContracts, submit]);

  const unsyncedContracts = contracts.filter((c) => !c.alreadySynced);

  // Format data for DataTable
  const rows = contracts.map((contract) => [
    <Checkbox
      key={`checkbox-${contract.id}`}
      label=""
      labelHidden
      checked={selectedContracts.has(contract.id)}
      disabled={contract.alreadySynced}
      onChange={() => handleSelectContract(contract.id)}
    />,
    <BlockStack key={`customer-${contract.id}`} gap="100">
      <Text as="span" fontWeight="semibold">{contract.customerName}</Text>
      {contract.customerEmail && (
        <Text as="span" tone="subdued">{contract.customerEmail}</Text>
      )}
    </BlockStack>,
    <Badge
      key={`status-${contract.id}`}
      tone={contract.status === "ACTIVE" ? "success" : contract.status === "PAUSED" ? "warning" : "critical"}
    >
      {contract.status}
    </Badge>,
    contract.frequency,
    <Text key={`products-${contract.id}`} as="span" truncate>{contract.products}</Text>,
    contract.totalAmount,
    contract.nextBillingDate
      ? new Date(contract.nextBillingDate).toLocaleDateString()
      : "-",
    contract.alreadySynced ? (
      <Badge key={`synced-${contract.id}`} tone="success">Synced</Badge>
    ) : (
      <Badge key={`notsynced-${contract.id}`}>Not Synced</Badge>
    ),
  ]);

  return (
    <Page
      title="Legacy Subscription Import"
      subtitle="Import pre-existing subscriptions from Shopify for migration"
      backAction={{ content: "Settings", url: "/app/settings/subscriptions" }}
      primaryAction={{
        content: `Import Selected (${selectedContracts.size})`,
        disabled: selectedContracts.size === 0 || isLoading,
        loading: isLoading,
        onAction: handleSyncSelected,
      }}
    >
      <TitleBar title="Legacy Subscription Import" />

      <Layout>
        <Layout.Section>
          {actionData && "success" in actionData && actionData.success && (
            <Banner
              title="Sync Complete"
              tone="success"
              onDismiss={() => {}}
            >
              <p>{actionData.message}</p>
              {actionData.errors && actionData.errors.length > 0 && (
                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">Errors:</Text>
                  {actionData.errors.map((err: string, i: number) => (
                    <Text key={i} as="p" tone="critical">{err}</Text>
                  ))}
                </BlockStack>
              )}
            </Banner>
          )}

          {actionData && "error" in actionData && (
            <Banner title="Error" tone="critical">
              <p>{actionData.error}</p>
            </Banner>
          )}

          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Shopify Subscription Contracts
                  </Text>
                  <Text as="p" tone="subdued">
                    Found {totalCount} subscription(s) in Shopify. {syncedCount} already synced.
                  </Text>
                </BlockStack>

                <InlineStack gap="300">
                  <Select
                    label="Filter by status"
                    labelInline
                    options={[
                      { label: "Active", value: "ACTIVE" },
                      { label: "Paused", value: "PAUSED" },
                      { label: "Cancelled", value: "CANCELLED" },
                      { label: "All", value: "" },
                    ]}
                    value={filterStatus}
                    onChange={handleStatusFilterChange}
                  />
                </InlineStack>
              </InlineStack>

              <Divider />

              {isLoading ? (
                <Box padding="400">
                  <InlineStack align="center" gap="200">
                    <Spinner size="small" />
                    <Text as="span">Loading...</Text>
                  </InlineStack>
                </Box>
              ) : contracts.length === 0 ? (
                <Box padding="400">
                  <Text as="p" alignment="center" tone="subdued">
                    No subscription contracts found with the selected filter.
                  </Text>
                </Box>
              ) : (
                <>
                  <InlineStack gap="200">
                    <Button
                      onClick={handleSelectAll}
                      disabled={unsyncedContracts.length === 0}
                    >
                      {selectedContracts.size === unsyncedContracts.length && unsyncedContracts.length > 0
                        ? "Deselect All"
                        : `Select All Unsynced (${unsyncedContracts.length})`}
                    </Button>
                  </InlineStack>

                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                      "numeric",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "",
                      "Customer",
                      "Status",
                      "Frequency",
                      "Products",
                      "Amount",
                      "Next Billing",
                      "Sync Status",
                    ]}
                    rows={rows}
                  />
                </>
              )}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  About Legacy Import
                </Text>
                <Badge tone="info">Migration Tool</Badge>
              </InlineStack>
              <Text as="p">
                This tool allows you to selectively import existing subscription contracts from Shopify
                into the Susies Sourdough Manager app. Use this for:
              </Text>
              <BlockStack gap="100">
                <Text as="p">• <strong>Migration:</strong> Import subscriptions created before this app was commercially deployed</Text>
                <Text as="p">• <strong>Recovery:</strong> Recover subscriptions that weren't captured by webhooks</Text>
                <Text as="p">• <strong>Testing:</strong> Selectively import specific subscriptions for testing</Text>
              </BlockStack>
              <Banner tone="warning">
                <p>
                  <strong>Default Preferences:</strong> Imported subscriptions will use default pickup preferences
                  (Tuesday, 12:00 PM - 2:00 PM). Customers can update their preferences through
                  the customer portal after import.
                </p>
              </Banner>
              <Banner tone="info">
                <p>
                  <strong>Temporary Feature:</strong> This legacy import tool is intended for the initial
                  migration period. Once all existing subscriptions have been imported and the app is
                  fully deployed, this feature can be removed.
                </p>
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
