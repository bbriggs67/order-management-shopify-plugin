import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSearchParams, useSubmit, useNavigation, Link } from "@remix-run/react";
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
  Banner,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import {
  searchCustomers,
  syncCustomersFromLocalData,
} from "../services/customer-crm.server";

// ============================================
// TYPES
// ============================================

interface LoaderData {
  customers: Array<{
    id: string;
    shopifyCustomerId: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    activeSubscriptionCount: number;
    lastOrderDate: string | null;
  }>;
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;
  synced?: number;
  syncError?: string;
}

// ============================================
// LOADER
// ============================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || undefined;
  const filter = url.searchParams.get("filter") || undefined;
  const cursor = url.searchParams.get("cursor") || undefined;
  const sort = url.searchParams.get("sort") || "name";
  const direction = url.searchParams.get("direction") || "asc";

  try {
    const result = await searchCustomers(shop, {
      search,
      filter,
      cursor,
      sort,
      direction,
    });

    return json<LoaderData>({
      customers: result.customers,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      totalCount: result.totalCount,
    });
  } catch (error) {
    console.error("Error loading customers:", error);
    return json<LoaderData>({
      customers: [],
      hasMore: false,
      nextCursor: null,
      totalCount: 0,
    });
  }
};

// ============================================
// ACTION
// ============================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action") as string;

  if (intent === "sync_customers") {
    try {
      const synced = await syncCustomersFromLocalData(shop, admin);
      return json({ synced, syncError: null });
    } catch (error) {
      console.error("Error syncing customers:", error);
      return json({ synced: 0, syncError: String(error) });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

// ============================================
// COMPONENT
// ============================================

export default function CustomersIndex() {
  const { customers, hasMore, nextCursor, totalCount } =
    useLoaderData<LoaderData>();
  const actionData = useActionData<{ synced?: number; syncError?: string | null }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const currentSearch = searchParams.get("search") || "";
  const currentSort = searchParams.get("sort") || "name";
  const currentDirection = searchParams.get("direction") || "asc";

  // Search handling
  const [queryValue, setQueryValue] = useState(currentSearch);

  const handleSearch = useCallback(
    (value: string) => {
      setQueryValue(value);
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("search", value);
      } else {
        params.delete("search");
      }
      params.delete("cursor"); // Reset pagination on search
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleSearchClear = useCallback(() => {
    handleSearch("");
  }, [handleSearch]);

  // Sort handling
  const handleSort = useCallback(
    (headingIndex: number, sortDirection: string) => {
      const sortFields = ["name", "email", "", "", ""];
      const field = sortFields[headingIndex];
      if (!field) return;

      const params = new URLSearchParams(searchParams);
      params.set("sort", field);
      params.set("direction", sortDirection === "ascending" ? "asc" : "desc");
      params.delete("cursor");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  // Pagination
  const handleNextPage = useCallback(() => {
    if (!nextCursor) return;
    const params = new URLSearchParams(searchParams);
    params.set("cursor", nextCursor);
    setSearchParams(params);
  }, [nextCursor, searchParams, setSearchParams]);

  const handlePrevPage = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete("cursor");
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  // Sync action
  const handleSync = useCallback(() => {
    const formData = new FormData();
    formData.set("_action", "sync_customers");
    submit(formData, { method: "post" });
  }, [submit]);

  // Format helpers
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Build DataTable rows
  const rows = customers.map((customer) => {
    const name = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(" ") || customer.email || "Unknown";

    return [
      <Link
        key={customer.id}
        to={`/app/customers/${customer.id}`}
        style={{ textDecoration: "none" }}
      >
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {name}
        </Text>
      </Link>,
      customer.email || "—",
      customer.phone || "—",
      customer.activeSubscriptionCount > 0 ? (
        <Badge tone="success" key={`sub-${customer.id}`}>
          {`${customer.activeSubscriptionCount} active`}
        </Badge>
      ) : (
        <Text as="span" tone="subdued" key={`sub-${customer.id}`}>
          None
        </Text>
      ),
      formatDate(customer.lastOrderDate),
    ];
  });

  // Sort direction for DataTable
  const sortColumnIndex = { name: 0, email: 1 }[
    currentSort
  ];
  const sortDirection =
    currentDirection === "asc" ? "ascending" : "descending";

  return (
    <Page>
      <TitleBar title="Customer Relations" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Header with sync button */}
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" tone="subdued">
                {totalCount} customer{totalCount !== 1 ? "s" : ""}
              </Text>
              <Button onClick={handleSync} loading={isLoading} size="slim">
                Sync Customers from Shopify
              </Button>
            </InlineStack>

            {/* Sync result banner */}
            {actionData?.synced !== undefined && actionData.synced > 0 && !actionData.syncError && (
              <Banner tone="success">
                {`Successfully synced ${actionData.synced} customer${actionData.synced !== 1 ? "s" : ""} from Shopify.`}
              </Banner>
            )}
            {actionData?.syncError && (
              <Banner tone="critical">
                {`Error syncing customers: ${actionData.syncError}`}
              </Banner>
            )}
            {actionData?.synced === 0 && !actionData.syncError && (
              <Banner tone="warning">
                No new customers found to sync. Customers are synced from existing order and subscription data.
              </Banner>
            )}

            {/* Search */}
            <Card padding="0">
              <Filters
                queryValue={queryValue}
                queryPlaceholder="Search by name, email, or phone..."
                onQueryChange={handleSearch}
                onQueryClear={handleSearchClear}
                filters={[]}
                onClearAll={handleSearchClear}
              />

              {customers.length === 0 ? (
                <div style={{ padding: "20px" }}>
                  <EmptyState
                    heading="No customers found"
                    image=""
                  >
                    <p>
                      {currentSearch
                        ? `No customers match "${currentSearch}". Try a different search.`
                        : "Click \"Sync Customers from Shopify\" to import your customer data."}
                    </p>
                  </EmptyState>
                </div>
              ) : (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "Customer",
                    "Email",
                    "Phone",
                    "Subscriptions",
                    "Last Order",
                  ]}
                  rows={rows}
                  sortable={[true, true, false, false, false]}
                  defaultSortDirection="ascending"
                  initialSortColumnIndex={sortColumnIndex}
                  onSort={handleSort}
                  footerContent={
                    <InlineStack align="center" gap="400">
                      {searchParams.has("cursor") && (
                        <Button onClick={handlePrevPage} size="slim">
                          &larr; First Page
                        </Button>
                      )}
                      {hasMore && (
                        <Button onClick={handleNextPage} size="slim">
                          Next Page &rarr;
                        </Button>
                      )}
                    </InlineStack>
                  }
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
