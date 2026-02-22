import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
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
  DataTable,
  EmptyState,
  Tabs,
  Thumbnail,
  Tooltip,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getContractDetailsBatch } from "../services/subscription-contracts.server";
import type {
  ContractLineItem,
  ContractDeliveryPolicy,
} from "../types/subscription-contracts";
import { formatCurrency, getDeliveryFrequencyLabel } from "../utils/formatting";
import { getDayName, FREQUENCY_LABELS } from "../utils/constants";

interface SubscriptionWithShopifyData {
  id: string;
  shopifyContractId: string;
  shopifyOrderNumber: string | null;
  customerName: string;
  customerEmail: string | null;
  status: string;
  frequency: string;
  preferredDay: number;
  nextPickupDate: string | null;
  discountPercent: number;
  // Shopify data (may be null for SSMA-native subscriptions)
  lines: ContractLineItem[];
  deliveryPolicy: ContractDeliveryPolicy | null;
  totalPrice: string;
  currencyCode: string;
  // SSMA source indicator
  isSSMANative: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const subscriptions = await prisma.subscriptionPickup.findMany({
    where: { shop },
    orderBy: { nextPickupDate: "asc" },
  });

  // Only query Shopify for actual Subscription Contract GIDs (not order GIDs)
  // SSMA-native subscriptions store order GIDs in shopifyContractId, which
  // start with "gid://shopify/Order/" instead of "gid://shopify/SubscriptionContract/"
  const shopifyContractIds = subscriptions
    .map((sub) => sub.shopifyContractId)
    .filter((id) => id.includes("SubscriptionContract"));

  const contractDetailsMap = shopifyContractIds.length > 0
    ? await getContractDetailsBatch(admin, shopifyContractIds)
    : new Map();

  // Map subscription data with Shopify contract details (or SSMA-native data)
  const subscriptionsWithDetails: SubscriptionWithShopifyData[] = subscriptions.map((sub) => {
    const isSSMANative = !sub.shopifyContractId.includes("SubscriptionContract");
    const contractDetails = contractDetailsMap.get(sub.shopifyContractId);

    return {
      id: sub.id,
      shopifyContractId: sub.shopifyContractId,
      shopifyOrderNumber: sub.shopifyOrderNumber || null,
      customerName: sub.customerName,
      customerEmail: sub.customerEmail,
      status: sub.status,
      frequency: sub.frequency,
      preferredDay: sub.preferredDay,
      nextPickupDate: sub.nextPickupDate?.toISOString() || null,
      discountPercent: sub.discountPercent,
      // Shopify data (empty for SSMA-native subscriptions)
      lines: contractDetails?.lines || [],
      deliveryPolicy: contractDetails?.deliveryPolicy || null,
      totalPrice: contractDetails?.pricingSummary?.totalPrice?.amount || "0.00",
      currencyCode: contractDetails?.pricingSummary?.totalPrice?.currencyCode || "USD",
      isSSMANative,
    };
  });

  const activeCount = subscriptions.filter((s) => s.status === "ACTIVE").length;
  const pausedCount = subscriptions.filter((s) => s.status === "PAUSED").length;
  const cancelledCount = subscriptions.filter(
    (s) => s.status === "CANCELLED"
  ).length;

  return json({
    subscriptions: subscriptionsWithDetails,
    activeCount,
    pausedCount,
    cancelledCount,
    shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "export_csv") {
    const subscriptions = await prisma.subscriptionPickup.findMany({
      where: { shop },
      orderBy: { customerName: "asc" },
    });

    // Build CSV content
    const headers = [
      "Contract ID",
      "Customer Name",
      "Customer Email",
      "Status",
      "Frequency",
      "Preferred Day",
      "Next Pickup Date",
      "Discount %",
      "Created At",
    ];

    const rows = subscriptions.map((sub) => [
      sub.shopifyContractId,
      sub.customerName,
      sub.customerEmail || "",
      sub.status,
      sub.frequency,
      getDayName(sub.preferredDay),
      sub.nextPickupDate?.toISOString().split("T")[0] || "",
      sub.discountPercent.toString(),
      sub.createdAt.toISOString().split("T")[0],
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    return new Response(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="subscriptions-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

// getDayName is imported from constants.ts

export default function SubscriptionsIndex() {
  const { subscriptions, activeCount, pausedCount, cancelledCount, shop } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isExporting = navigation.state === "submitting";

  const [selectedTab, setSelectedTab] = useState(0);

  const handleTabChange = useCallback(
    (selectedTabIndex: number) => setSelectedTab(selectedTabIndex),
    []
  );

  const handleExportCSV = useCallback(() => {
    submit({ intent: "export_csv" }, { method: "post" });
  }, [submit]);

  const tabs = [
    {
      id: "all",
      content: `All (${subscriptions.length})`,
      accessibilityLabel: "All subscriptions",
      panelID: "all-subscriptions",
    },
    {
      id: "active",
      content: `Active (${activeCount})`,
      accessibilityLabel: "Active subscriptions",
      panelID: "active-subscriptions",
    },
    {
      id: "paused",
      content: `Paused (${pausedCount})`,
      accessibilityLabel: "Paused subscriptions",
      panelID: "paused-subscriptions",
    },
    {
      id: "cancelled",
      content: `Cancelled (${cancelledCount})`,
      accessibilityLabel: "Cancelled subscriptions",
      panelID: "cancelled-subscriptions",
    },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge tone="success">Active</Badge>;
      case "PAUSED":
        return <Badge tone="warning">Paused</Badge>;
      case "CANCELLED":
        return <Badge tone="critical">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const renderProductCell = (lines: ContractLineItem[]) => {
    if (lines.length === 0) {
      return <Text as="span" tone="subdued">No products</Text>;
    }

    if (lines.length === 1) {
      const line = lines[0];
      return (
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          {line.variantImage?.url && (
            <Thumbnail
              source={line.variantImage.url}
              alt={line.variantImage.altText || line.title}
              size="small"
            />
          )}
          <BlockStack gap="0">
            <Text as="span" fontWeight="medium" truncate>
              {line.title}
            </Text>
            {line.quantity > 1 && (
              <Text as="span" tone="subdued" variant="bodySm">
                x{line.quantity}
              </Text>
            )}
          </BlockStack>
        </InlineStack>
      );
    }

    // Multiple products - show first image and count
    const firstWithImage = lines.find((l) => l.variantImage?.url);
    return (
      <Tooltip content={lines.map((l) => `${l.title} (x${l.quantity})`).join(", ")}>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          {firstWithImage?.variantImage?.url && (
            <Thumbnail
              source={firstWithImage.variantImage.url}
              alt={firstWithImage.variantImage.altText || "Products"}
              size="small"
            />
          )}
          <Text as="span">{lines.length} products</Text>
        </InlineStack>
      </Tooltip>
    );
  };

  const filteredSubscriptions = subscriptions.filter((sub) => {
    if (selectedTab === 0) return true;
    if (selectedTab === 1) return sub.status === "ACTIVE";
    if (selectedTab === 2) return sub.status === "PAUSED";
    if (selectedTab === 3) return sub.status === "CANCELLED";
    return true;
  });

  const tableRows = filteredSubscriptions.map((sub) => [
    <BlockStack gap="0" key={`name-${sub.id}`}>
      <Text as="span" fontWeight="medium">{sub.customerName}</Text>
      {sub.shopifyOrderNumber && (
        <Text as="span" tone="subdued" variant="bodySm">{sub.shopifyOrderNumber}</Text>
      )}
    </BlockStack>,
    sub.lines.length > 0
      ? renderProductCell(sub.lines)
      : <Text as="span" tone="subdued">SSMA Subscription</Text>,
    sub.lines.length > 0
      ? formatCurrency(sub.totalPrice, sub.currencyCode)
      : `${sub.discountPercent}% off`,
    sub.deliveryPolicy
      ? getDeliveryFrequencyLabel(sub.deliveryPolicy)
      : FREQUENCY_LABELS[sub.frequency] || sub.frequency,
    formatDate(sub.nextPickupDate),
    getStatusBadge(sub.status),
    <Button
      key={sub.id}
      url={`/app/subscriptions/${encodeURIComponent(sub.shopifyContractId)}`}
      size="slim"
    >
      Manage
    </Button>,
  ]);

  return (
    <Page
      title="Subscriptions"
      primaryAction={{
        content: "Export CSV",
        onAction: handleExportCSV,
        loading: isExporting,
      }}
    >
      <TitleBar title="Subscriptions" />
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
              <BlockStack gap="400">
                {filteredSubscriptions.length > 0 ? (
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "numeric",
                      "text",
                      "text",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "Customer",
                      "Product",
                      "Price",
                      "Frequency",
                      "Next Pickup",
                      "Status",
                      "Actions",
                    ]}
                    rows={tableRows}
                  />
                ) : (
                  <EmptyState
                    heading="No subscriptions found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Customer subscriptions will appear here once they sign up
                      for recurring orders.
                    </p>
                  </EmptyState>
                )}
              </BlockStack>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
