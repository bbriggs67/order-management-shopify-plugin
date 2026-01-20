import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
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
  Filters,
  ChoiceList,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");

  const where: any = { shop };

  if (status && status !== "all") {
    where.pickupStatus = status;
  }

  if (search) {
    where.OR = [
      { customerName: { contains: search, mode: "insensitive" } },
      { shopifyOrderNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  const pickups = await prisma.pickupSchedule.findMany({
    where,
    orderBy: { pickupDate: "desc" },
    take: 50,
    include: {
      subscriptionPickup: true,
    },
  });

  return json({ pickups });
};

export default function OrdersIndex() {
  const { pickups } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [statusFilter, setStatusFilter] = useState<string[]>(
    searchParams.get("status") ? [searchParams.get("status")!] : []
  );
  const [searchValue, setSearchValue] = useState(
    searchParams.get("search") || ""
  );

  const handleStatusChange = useCallback((value: string[]) => {
    setStatusFilter(value);
    const params = new URLSearchParams(searchParams);
    if (value.length > 0) {
      params.set("status", value[0]);
    } else {
      params.delete("status");
    }
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  const handleSearchSubmit = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (searchValue) {
      params.set("search", searchValue);
    } else {
      params.delete("search");
    }
    setSearchParams(params);
  }, [searchValue, searchParams, setSearchParams]);

  const handleClearAll = useCallback(() => {
    setStatusFilter([]);
    setSearchValue("");
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "SCHEDULED":
        return <Badge tone="info">Scheduled</Badge>;
      case "READY":
        return <Badge tone="success">Ready</Badge>;
      case "PICKED_UP":
        return <Badge>Picked Up</Badge>;
      case "CANCELLED":
        return <Badge tone="critical">Cancelled</Badge>;
      case "NO_SHOW":
        return <Badge tone="warning">No Show</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const tableRows = pickups.map((pickup) => [
    pickup.shopifyOrderNumber,
    pickup.customerName,
    formatDate(pickup.pickupDate),
    pickup.pickupTimeSlot,
    <InlineStack gap="100" key={`badges-${pickup.id}`}>
      {getStatusBadge(pickup.pickupStatus)}
      {pickup.subscriptionPickup && (
        <Badge tone="info">Subscription</Badge>
      )}
    </InlineStack>,
    <Button
      key={pickup.id}
      url={`/app/orders/${encodeURIComponent(pickup.shopifyOrderId)}`}
      size="slim"
    >
      View
    </Button>,
  ]);

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "Scheduled", value: "SCHEDULED" },
            { label: "Ready", value: "READY" },
            { label: "Picked Up", value: "PICKED_UP" },
            { label: "Cancelled", value: "CANCELLED" },
            { label: "No Show", value: "NO_SHOW" },
          ]}
          selected={statusFilter}
          onChange={handleStatusChange}
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = statusFilter.length > 0
    ? [
        {
          key: "status",
          label: `Status: ${statusFilter[0]}`,
          onRemove: () => handleStatusChange([]),
        },
      ]
    : [];

  return (
    <Page>
      <TitleBar title="Orders & Pickups" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Filters
                queryValue={searchValue}
                queryPlaceholder="Search by customer or order #"
                filters={filters}
                appliedFilters={appliedFilters}
                onQueryChange={handleSearchChange}
                onQueryClear={() => {
                  setSearchValue("");
                  const params = new URLSearchParams(searchParams);
                  params.delete("search");
                  setSearchParams(params);
                }}
                onClearAll={handleClearAll}
              />

              {pickups.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "Order",
                    "Customer",
                    "Pickup Date",
                    "Time Slot",
                    "Status",
                    "Actions",
                  ]}
                  rows={tableRows}
                />
              ) : (
                <EmptyState
                  heading="No orders found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Orders with pickup schedules will appear here once customers
                    start placing orders.
                  </p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
