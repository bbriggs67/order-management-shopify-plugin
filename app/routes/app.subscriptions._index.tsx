import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const subscriptions = await prisma.subscriptionPickup.findMany({
    where: { shop },
    orderBy: { nextPickupDate: "asc" },
  });

  const activeCount = subscriptions.filter((s) => s.status === "ACTIVE").length;
  const pausedCount = subscriptions.filter((s) => s.status === "PAUSED").length;
  const cancelledCount = subscriptions.filter(
    (s) => s.status === "CANCELLED"
  ).length;

  return json({
    subscriptions,
    activeCount,
    pausedCount,
    cancelledCount,
  });
};

export default function SubscriptionsIndex() {
  const { subscriptions, activeCount, pausedCount, cancelledCount } =
    useLoaderData<typeof loader>();

  const [selectedTab, setSelectedTab] = useState(0);

  const handleTabChange = useCallback(
    (selectedTabIndex: number) => setSelectedTab(selectedTabIndex),
    []
  );

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

  const getFrequencyLabel = (frequency: string) => {
    switch (frequency) {
      case "WEEKLY":
        return "Weekly (10% off)";
      case "BIWEEKLY":
        return "Bi-weekly (5% off)";
      default:
        return frequency;
    }
  };

  const getDayName = (dayNum: number) => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[dayNum] || "Unknown";
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const filteredSubscriptions = subscriptions.filter((sub) => {
    if (selectedTab === 0) return true;
    if (selectedTab === 1) return sub.status === "ACTIVE";
    if (selectedTab === 2) return sub.status === "PAUSED";
    if (selectedTab === 3) return sub.status === "CANCELLED";
    return true;
  });

  const tableRows = filteredSubscriptions.map((sub) => [
    sub.customerName,
    sub.customerEmail || "—",
    getFrequencyLabel(sub.frequency),
    getDayName(sub.preferredDay),
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
    <Page>
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
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "Customer",
                      "Email",
                      "Frequency",
                      "Preferred Day",
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
