import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
  Link,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  Modal,
  TextField,
  Select,
  Collapsible,
  EmptyState,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import {
  getCustomerDetail,
  addCustomerNote,
  updateCustomerNote,
  deleteCustomerNote,
  togglePinNote,
  syncNotesToShopify,
} from "../services/customer-crm.server";
import {
  createDraftOrder,
  sendDraftOrderInvoice,
  sendPaymentLinkViaSMS,
} from "../services/draft-orders.server";
import { isIntegrationConfigured } from "../utils/env.server";
import { NOTE_CATEGORIES } from "../types/customer-crm";
import type { CustomerDetail, CustomerNoteData, DraftOrderResult } from "../types/customer-crm";

// ============================================
// HELPERS
// ============================================

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-Weekly",
  TRIWEEKLY: "Tri-Weekly",
};

function statusTone(status: string): "info" | "success" | "warning" | "critical" | "attention" | undefined {
  switch (status) {
    case "SCHEDULED": return "info";
    case "READY": return "success";
    case "PICKED_UP": return undefined;
    case "CANCELLED": return "critical";
    case "NO_SHOW": return "warning";
    case "ACTIVE": return "success";
    case "PAUSED": return "warning";
    default: return undefined;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(amount: string | null, currency: string): string {
  if (!amount) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(parseFloat(amount));
}

function categoryBadgeTone(category: string | null): "info" | "success" | "warning" | "attention" | undefined {
  switch (category) {
    case "preference": return "info";
    case "family": return "success";
    case "allergy": return "warning";
    case "delivery": return "attention";
    default: return undefined;
  }
}

// ============================================
// LOADER
// ============================================

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const customerId = params.customerId;

  if (!customerId) {
    throw new Response("Customer ID required", { status: 400 });
  }

  const customer = await getCustomerDetail(admin, shop, customerId);

  if (!customer) {
    throw new Response("Customer not found", { status: 404 });
  }

  return json({
    customer,
    isTwilioConfigured: isIntegrationConfigured("twilio"),
    isSendGridConfigured: isIntegrationConfigured("sendgrid"),
  });
};

// ============================================
// ACTION
// ============================================

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const customerId = params.customerId!;
  const formData = await request.formData();
  const intent = formData.get("_action") as string;

  if (intent === "addNote") {
    const content = formData.get("content") as string;
    const category = formData.get("category") as string;
    if (!content || content.trim().length === 0) {
      return json({ error: "Note content is required" }, { status: 400 });
    }
    await addCustomerNote(shop, customerId, content.trim(), category || "general");
    return json({ success: true });
  }

  if (intent === "updateNote") {
    const noteId = formData.get("noteId") as string;
    const content = formData.get("content") as string;
    const category = formData.get("category") as string;
    if (!noteId || !content) {
      return json({ error: "Note ID and content required" }, { status: 400 });
    }
    await updateCustomerNote(noteId, content.trim(), category);
    return json({ success: true });
  }

  if (intent === "deleteNote") {
    const noteId = formData.get("noteId") as string;
    if (!noteId) {
      return json({ error: "Note ID required" }, { status: 400 });
    }
    await deleteCustomerNote(noteId);
    return json({ success: true });
  }

  if (intent === "pinNote") {
    const noteId = formData.get("noteId") as string;
    if (!noteId) {
      return json({ error: "Note ID required" }, { status: 400 });
    }
    await togglePinNote(noteId);
    return json({ success: true });
  }

  if (intent === "syncToShopify") {
    const result = await syncNotesToShopify(admin, shop, customerId);
    if (!result.success) {
      return json({ error: result.error }, { status: 500 });
    }
    return json({ success: true, synced: true });
  }

  // ---- Draft Order Actions ----

  if (intent === "createDraftOrder") {
    try {
      const lineItemsJson = formData.get("lineItems") as string;
      const note = formData.get("note") as string;
      const shopifyCustomerGid = formData.get("shopifyCustomerId") as string;

      if (!lineItemsJson || !shopifyCustomerGid) {
        return json({ error: "Line items and customer ID required" }, { status: 400 });
      }

      const lineItems = JSON.parse(lineItemsJson) as Array<{
        variantId: string;
        quantity: number;
      }>;

      if (lineItems.length === 0) {
        return json({ error: "At least one line item is required" }, { status: 400 });
      }

      const draftOrder = await createDraftOrder(admin, {
        customerId: shopifyCustomerGid,
        lineItems,
        note: note || undefined,
        tags: ["crm-order"],
      });

      return json({ success: true, draftOrder });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Failed to create draft order" },
        { status: 500 }
      );
    }
  }

  if (intent === "sendInvoice") {
    try {
      const draftOrderId = formData.get("draftOrderId") as string;
      const method = formData.get("method") as string;
      const phone = formData.get("phone") as string;
      const customerName = formData.get("customerName") as string;
      const invoiceUrl = formData.get("invoiceUrl") as string;
      const orderName = formData.get("orderName") as string;

      if (!draftOrderId || !method) {
        return json({ error: "Draft order ID and method required" }, { status: 400 });
      }

      if (method === "shopify_email") {
        const result = await sendDraftOrderInvoice(admin, draftOrderId);
        return json({ success: result.success, invoiceError: result.error, invoiceMethod: "email" });
      }

      if (method === "sms") {
        if (!phone || !customerName || !invoiceUrl || !orderName) {
          return json({ error: "Phone, customer name, invoice URL, and order name required for SMS" }, { status: 400 });
        }
        const result = await sendPaymentLinkViaSMS(phone, customerName, invoiceUrl, orderName);
        return json({ success: result.success, invoiceError: result.error, invoiceMethod: "sms" });
      }

      return json({ error: "Invalid send method" }, { status: 400 });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Failed to send invoice" },
        { status: 500 }
      );
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

// ============================================
// MAIN COMPONENT
// ============================================

// ============================================
// SELECTED PRODUCT TYPE (from resource picker)
// ============================================

interface LineItem {
  productTitle: string;
  variantId: string;
  variantTitle: string;
  quantity: number;
  price: string;
  imageUrl?: string;
}

export default function CustomerDetailPage() {
  const { customer, isTwilioConfigured, isSendGridConfigured } = useLoaderData<{
    customer: CustomerDetail;
    isTwilioConfigured: boolean;
    isSendGridConfigured: boolean;
  }>();
  const actionData = useActionData<{
    success?: boolean;
    error?: string;
    draftOrder?: DraftOrderResult;
    invoiceError?: string;
    invoiceMethod?: string;
    synced?: boolean;
  }>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = navigation.state === "submitting";

  // --- Create Order state ---
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [orderNote, setOrderNote] = useState("");

  // --- Invoice Sending state ---
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [currentDraftOrder, setCurrentDraftOrder] = useState<DraftOrderResult | null>(null);
  const [invoiceBanner, setInvoiceBanner] = useState<{ status: "success" | "critical"; message: string } | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  const fullName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ") || customer.email || "Unknown Customer";

  // React to actionData changes (render-time state sync)
  const [lastActionData, setLastActionData] = useState(actionData);
  if (actionData !== lastActionData) {
    setLastActionData(actionData);
    if (actionData?.draftOrder) {
      setCurrentDraftOrder(actionData.draftOrder);
      setCreateOrderOpen(false);
      setLineItems([]);
      setOrderNote("");
      setInvoiceModalOpen(true);
      setInvoiceBanner(null);
    }
    if (actionData?.invoiceMethod) {
      if (actionData.success) {
        setInvoiceBanner({
          status: "success",
          message: actionData.invoiceMethod === "email"
            ? "Shopify invoice email sent successfully!"
            : "Payment link sent via SMS!",
        });
      } else {
        setInvoiceBanner({
          status: "critical",
          message: actionData.invoiceError || "Failed to send invoice",
        });
      }
    }
  }

  // --- Product Picker ---
  const handlePickProducts = useCallback(async () => {
    try {
      const selected = await (shopify as any).resourcePicker({
        type: "product",
        multiple: true,
        filter: { variants: true },
      });

      if (selected && selected.length > 0) {
        const newItems: LineItem[] = [];
        for (const product of selected) {
          const p = product as {
            id: string;
            title: string;
            images?: Array<{ originalSrc?: string }>;
            variants?: Array<{
              id: string;
              title: string;
              price: string;
            }>;
          };
          // For each product, add its first variant (or all variants if multi-variant)
          const variants = p.variants || [];
          if (variants.length === 0) continue;

          // If product has only a "Default Title" variant, use the product title
          for (const v of variants) {
            // Skip if this variant is already in the list
            if (lineItems.some((li) => li.variantId === v.id)) continue;
            if (newItems.some((li) => li.variantId === v.id)) continue;

            newItems.push({
              productTitle: p.title,
              variantId: v.id,
              variantTitle: v.title === "Default Title" ? "" : v.title,
              quantity: 1,
              price: v.price,
              imageUrl: p.images?.[0]?.originalSrc,
            });
          }
        }
        setLineItems((prev) => [...prev, ...newItems]);
      }
    } catch (err) {
      console.error("Resource picker error:", err);
    }
  }, [shopify, lineItems]);

  // --- Line Item Quantity ---
  const handleQuantityChange = useCallback((variantId: string, delta: number) => {
    setLineItems((prev) =>
      prev.map((item) =>
        item.variantId === variantId
          ? { ...item, quantity: Math.max(1, item.quantity + delta) }
          : item
      )
    );
  }, []);

  const handleRemoveItem = useCallback((variantId: string) => {
    setLineItems((prev) => prev.filter((item) => item.variantId !== variantId));
  }, []);

  // --- Create Draft Order ---
  const handleCreateDraftOrder = useCallback(() => {
    if (lineItems.length === 0) return;
    const formData = new FormData();
    formData.set("_action", "createDraftOrder");
    formData.set("shopifyCustomerId", customer.shopifyCustomerId);
    formData.set(
      "lineItems",
      JSON.stringify(lineItems.map((li) => ({ variantId: li.variantId, quantity: li.quantity })))
    );
    if (orderNote.trim()) {
      formData.set("note", orderNote.trim());
    }
    submit(formData, { method: "post" });
  }, [lineItems, orderNote, customer.shopifyCustomerId, submit]);

  // --- Send Invoice ---
  const handleSendInvoice = useCallback(
    (method: "shopify_email" | "sms") => {
      if (!currentDraftOrder) return;
      const formData = new FormData();
      formData.set("_action", "sendInvoice");
      formData.set("draftOrderId", currentDraftOrder.id);
      formData.set("method", method);
      if (method === "sms") {
        formData.set("phone", customer.phone || "");
        formData.set("customerName", fullName);
        formData.set("invoiceUrl", currentDraftOrder.invoiceUrl);
        formData.set("orderName", currentDraftOrder.name);
      }
      submit(formData, { method: "post" });
    },
    [currentDraftOrder, customer.phone, fullName, submit]
  );

  // --- Copy Invoice Link ---
  const handleCopyLink = useCallback(async () => {
    if (!currentDraftOrder) return;
    try {
      await navigator.clipboard.writeText(currentDraftOrder.invoiceUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback: select text in a temporary input
      const input = document.createElement("input");
      input.value = currentDraftOrder.invoiceUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  }, [currentDraftOrder]);

  // Calculate order total
  const orderTotal = lineItems.reduce(
    (sum, item) => sum + parseFloat(item.price || "0") * item.quantity,
    0
  );

  // Shopify admin URL for customer
  const shopifyCustomerUrl = customer.shopifyCustomerId.startsWith("local:")
    ? null
    : `https://admin.shopify.com/store/${getStoreHandle()}/customers/${extractShopifyId(customer.shopifyCustomerId)}`;

  return (
    <Page
      backAction={{ content: "Customers", url: "/app/customers" }}
      title={fullName}
      titleMetadata={
        customer.activeSubscriptionCount > 0 ? (
          <Badge tone="success">
            {`${customer.activeSubscriptionCount} active subscription${customer.activeSubscriptionCount !== 1 ? "s" : ""}`}
          </Badge>
        ) : undefined
      }
      secondaryActions={
        shopifyCustomerUrl
          ? [
              {
                content: "View in Shopify",
                url: shopifyCustomerUrl,
                external: true,
              },
            ]
          : []
      }
    >
      <TitleBar title={fullName} />
      <Layout>
        {/* MAIN CONTENT — Left 2/3 */}
        <Layout.Section>
          <BlockStack gap="400">
            {/* ACTIONS CARD */}
            <Card>
              <InlineStack gap="300" wrap>
                {!customer.shopifyCustomerId.startsWith("local:") && (
                  <Button
                    variant="primary"
                    onClick={() => setCreateOrderOpen(true)}
                    size="slim"
                  >
                    Create Order
                  </Button>
                )}
                {customer.email && (
                  <Button
                    url={`mailto:${customer.email}`}
                    external
                    size="slim"
                  >
                    Send Email
                  </Button>
                )}
                {customer.phone && (
                  <Button
                    url={`sms:${customer.phone}`}
                    external
                    size="slim"
                  >
                    Send Text
                  </Button>
                )}
              </InlineStack>
            </Card>

            {/* DRAFT ORDER SUCCESS BANNER */}
            {actionData?.draftOrder && !createOrderOpen && (
              <Banner tone="success">
                Draft order {actionData.draftOrder.name} created
                ({formatCurrency(actionData.draftOrder.totalPrice, actionData.draftOrder.currencyCode)})
              </Banner>
            )}

            {/* DRAFT ORDER ERROR BANNER */}
            {actionData?.error && !actionData?.invoiceMethod && !actionData?.synced && (
              <Banner tone="critical">{actionData.error}</Banner>
            )}

            {/* ORDERS CARD */}
            <OrdersSection orders={customer.orders} />

            {/* SUBSCRIPTIONS CARD */}
            <SubscriptionsSection subscriptions={customer.subscriptions} />

            {/* NOTES CARD */}
            <NotesSection
              notes={customer.notes}
              submit={submit}
              isSubmitting={isSubmitting}
              customerId={customer.id}
              shopifyLinked={!customer.shopifyCustomerId.startsWith("local:")}
            />
          </BlockStack>
        </Layout.Section>

        {/* SIDEBAR — Right 1/3 */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* CONTACT INFO */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Contact Information
                </Text>
                <Divider />

                {customer.email && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Email</Text>
                    <a href={`mailto:${customer.email}`} style={{ textDecoration: "none", color: "#2C6ECB" }}>
                      {customer.email}
                    </a>
                  </BlockStack>
                )}

                {customer.phone && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Phone</Text>
                    <a href={`tel:${customer.phone}`} style={{ textDecoration: "none", color: "#2C6ECB" }}>
                      {customer.phone}
                    </a>
                  </BlockStack>
                )}

                {customer.defaultAddress && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Address</Text>
                    <Text as="p" variant="bodyMd">
                      {[
                        customer.defaultAddress.address1,
                        customer.defaultAddress.address2,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {[
                        customer.defaultAddress.city,
                        customer.defaultAddress.province,
                        customer.defaultAddress.zip,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </Text>
                    {customer.defaultAddress.country && (
                      <Text as="p" variant="bodyMd">
                        {customer.defaultAddress.country}
                      </Text>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* CUSTOMER STATS */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Customer Stats
                </Text>
                <Divider />

                <InlineStack align="space-between">
                  <Text as="p" variant="bodySm" tone="subdued">Total Orders</Text>
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    {customer.totalOrderCount}
                  </Text>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text as="p" variant="bodySm" tone="subdued">Total Spent</Text>
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    {formatCurrency(customer.totalSpent, customer.currency)}
                  </Text>
                </InlineStack>

                <InlineStack align="space-between">
                  <Text as="p" variant="bodySm" tone="subdued">Active Subscriptions</Text>
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    {customer.activeSubscriptionCount}
                  </Text>
                </InlineStack>

                {customer.memberSince && (
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodySm" tone="subdued">Customer Since</Text>
                    <Text as="p" variant="bodyMd">
                      {formatDate(customer.memberSince)}
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            {/* SHOPIFY TAGS */}
            {customer.shopifyTags.length > 0 && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Tags</Text>
                  <InlineStack gap="100" wrap>
                    {customer.shopifyTags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {/* SHOPIFY NOTE */}
            {customer.shopifyNote && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Shopify Note</Text>
                  <Text as="p" variant="bodySm">
                    {customer.shopifyNote}
                  </Text>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* ============================================ */}
      {/* CREATE ORDER MODAL                          */}
      {/* ============================================ */}
      <Modal
        open={createOrderOpen}
        onClose={() => setCreateOrderOpen(false)}
        title="Create Order"
        primaryAction={{
          content: "Create Draft Order",
          onAction: handleCreateDraftOrder,
          disabled: lineItems.length === 0 || isSubmitting,
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setCreateOrderOpen(false) },
        ]}
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Button onClick={handlePickProducts} size="slim">
              Add Products
            </Button>

            {lineItems.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                No products selected. Click "Add Products" to browse the catalog.
              </Text>
            ) : (
              <BlockStack gap="300">
                {lineItems.map((item) => (
                  <Box
                    key={item.variantId}
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <InlineStack gap="300" blockAlign="center">
                        {item.imageUrl && (
                          <Thumbnail
                            source={item.imageUrl}
                            alt={item.productTitle}
                            size="small"
                          />
                        )}
                        <BlockStack gap="050">
                          <Text as="span" variant="bodyMd" fontWeight="bold">
                            {item.productTitle}
                          </Text>
                          {item.variantTitle && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              {item.variantTitle}
                            </Text>
                          )}
                          <Text as="span" variant="bodySm" tone="subdued">
                            {formatCurrency(item.price, customer.currency)} each
                          </Text>
                        </BlockStack>
                      </InlineStack>

                      <InlineStack gap="200" blockAlign="center">
                        <Button
                          onClick={() => handleQuantityChange(item.variantId, -1)}
                          size="slim"
                          disabled={item.quantity <= 1}
                        >
                          −
                        </Button>
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          {item.quantity}
                        </Text>
                        <Button
                          onClick={() => handleQuantityChange(item.variantId, 1)}
                          size="slim"
                        >
                          +
                        </Button>
                        <Button
                          onClick={() => handleRemoveItem(item.variantId)}
                          size="slim"
                          tone="critical"
                        >
                          Remove
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                ))}

                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    Estimated Total
                  </Text>
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    {formatCurrency(orderTotal.toFixed(2), customer.currency)}
                  </Text>
                </InlineStack>
              </BlockStack>
            )}

            <TextField
              label="Order Note (optional)"
              value={orderNote}
              onChange={setOrderNote}
              multiline={2}
              autoComplete="off"
              maxLength={500}
              placeholder="Phone order, special request, etc."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ============================================ */}
      {/* INVOICE SENDING MODAL                       */}
      {/* ============================================ */}
      <Modal
        open={invoiceModalOpen}
        onClose={() => {
          setInvoiceModalOpen(false);
          setInvoiceBanner(null);
          setCopySuccess(false);
        }}
        title="Send Payment Link"
        secondaryActions={[
          {
            content: "Done",
            onAction: () => {
              setInvoiceModalOpen(false);
              setInvoiceBanner(null);
              setCopySuccess(false);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {/* Draft Order Summary */}
            {currentDraftOrder && (
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodyMd" fontWeight="bold">
                      {currentDraftOrder.name}
                    </Text>
                    <Text as="p" variant="bodyMd" fontWeight="bold">
                      {formatCurrency(currentDraftOrder.totalPrice, currentDraftOrder.currencyCode)}
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    For: {fullName}
                  </Text>
                </BlockStack>
              </Box>
            )}

            {/* Status Banner */}
            {invoiceBanner && (
              <Banner tone={invoiceBanner.status}>
                {invoiceBanner.message}
              </Banner>
            )}

            {/* Send Options */}
            <BlockStack gap="300">
              {/* Shopify Invoice Email */}
              <Button
                onClick={() => handleSendInvoice("shopify_email")}
                size="slim"
                loading={isSubmitting}
                fullWidth
              >
                Send Shopify Invoice Email
              </Button>
              <Text as="p" variant="bodySm" tone="subdued">
                Sends Shopify's built-in invoice email to {customer.email || "the customer"}
              </Text>

              <Divider />

              {/* SMS */}
              {customer.phone ? (
                <>
                  <Button
                    onClick={() => handleSendInvoice("sms")}
                    size="slim"
                    loading={isSubmitting}
                    disabled={!isTwilioConfigured}
                    fullWidth
                  >
                    Send Payment Link via Text
                  </Button>
                  {!isTwilioConfigured ? (
                    <Text as="p" variant="bodySm" tone="caution">
                      Twilio is not configured. Set up Twilio in Settings to enable SMS.
                    </Text>
                  ) : (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Sends SMS with payment link to {customer.phone}
                    </Text>
                  )}
                </>
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  No phone number on file — SMS not available
                </Text>
              )}

              <Divider />

              {/* Copy Link */}
              <Button
                onClick={handleCopyLink}
                size="slim"
                fullWidth
              >
                {copySuccess ? "Copied!" : "Copy Payment Link"}
              </Button>
              {currentDraftOrder && (
                <Text as="p" variant="bodySm" tone="subdued" breakWord>
                  {currentDraftOrder.invoiceUrl}
                </Text>
              )}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// ============================================
// ORDERS SECTION (Collapsible)
// ============================================

function OrdersSection({ orders }: { orders: CustomerDetail["orders"] }) {
  const [showAll, setShowAll] = useState(false);
  const INITIAL_COUNT = 3;

  const visibleOrders = showAll ? orders : orders.slice(0, INITIAL_COUNT);
  const hasMore = orders.length > INITIAL_COUNT;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            Orders ({orders.length})
          </Text>
          {hasMore && (
            <Button onClick={() => setShowAll(!showAll)} size="slim">
              {showAll ? "Show Recent" : `Show All (${orders.length})`}
            </Button>
          )}
        </InlineStack>

        {orders.length === 0 ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            No orders found.
          </Text>
        ) : (
          <BlockStack gap="200">
            {visibleOrders.map((order) => (
              <Box
                key={order.id}
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <InlineStack gap="200" blockAlign="center">
                      <Link
                        to={
                          order.isSubscription && order.subscriptionContractId
                            ? `/app/subscriptions/${encodeURIComponent(order.subscriptionContractId)}`
                            : `/app/orders/${encodeURIComponent(order.shopifyOrderId)}`
                        }
                        style={{ textDecoration: "none" }}
                      >
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          {order.shopifyOrderNumber}
                        </Text>
                      </Link>
                      <Badge tone={statusTone(order.pickupStatus)}>
                        {order.pickupStatus}
                      </Badge>
                      {order.isSubscription && (
                        <Badge tone="info" size="small">Subscription</Badge>
                      )}
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {formatDate(order.createdAt)}
                    </Text>
                  </InlineStack>

                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Pickup: {formatDate(order.pickupDate)} &bull; {order.pickupTimeSlot}
                    </Text>
                  </InlineStack>

                  {order.items.length > 0 && (
                    <BlockStack gap="050">
                      {order.items.map((item, idx) => (
                        <Text as="p" variant="bodySm" key={idx}>
                          &bull; {item.productTitle}
                          {item.variantTitle ? ` (${item.variantTitle})` : ""}
                          {" "}&times; {item.quantity}
                        </Text>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Box>
            ))}

            {/* Collapsed orders indicator */}
            {!showAll && hasMore && (
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                {orders.length - INITIAL_COUNT} more order{orders.length - INITIAL_COUNT !== 1 ? "s" : ""} not shown
              </Text>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ============================================
// SUBSCRIPTIONS SECTION
// ============================================

function SubscriptionsSection({
  subscriptions,
}: {
  subscriptions: CustomerDetail["subscriptions"];
}) {
  const active = subscriptions.filter((s) => s.status === "ACTIVE");
  const other = subscriptions.filter((s) => s.status !== "ACTIVE");

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          Subscriptions ({subscriptions.length})
        </Text>

        {subscriptions.length === 0 ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            No subscriptions.
          </Text>
        ) : (
          <BlockStack gap="200">
            {[...active, ...other].map((sub) => (
              <Box
                key={sub.id}
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="bold">
                        {FREQUENCY_LABELS[sub.frequency] || sub.frequency}
                      </Text>
                      <Badge tone={statusTone(sub.status)}>
                        {sub.status}
                      </Badge>
                      {sub.discountPercent > 0 && (
                        <Badge tone="info" size="small">
                          {`${sub.discountPercent}% off`}
                        </Badge>
                      )}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {DAY_NAMES[sub.preferredDay]} &bull; {sub.preferredTimeSlot}
                      {sub.nextPickupDate && ` &bull; Next: ${formatDate(sub.nextPickupDate)}`}
                    </Text>
                  </BlockStack>
                  <Link
                    to={`/app/subscriptions/${encodeURIComponent(sub.shopifyContractId)}`}
                  >
                    <Button size="slim">Manage</Button>
                  </Link>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ============================================
// NOTES SECTION
// ============================================

function NotesSection({
  notes,
  submit,
  isSubmitting,
  customerId,
  shopifyLinked,
}: {
  notes: CustomerNoteData[];
  submit: ReturnType<typeof useSubmit>;
  isSubmitting: boolean;
  customerId: string;
  shopifyLinked: boolean;
}) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<CustomerNoteData | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [noteCategory, setNoteCategory] = useState("general");

  const handleOpenAdd = useCallback(() => {
    setEditingNote(null);
    setNoteContent("");
    setNoteCategory("general");
    setAddModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((note: CustomerNoteData) => {
    setEditingNote(note);
    setNoteContent(note.content);
    setNoteCategory(note.category || "general");
    setAddModalOpen(true);
  }, []);

  const handleSaveNote = useCallback(() => {
    if (!noteContent.trim()) return;
    const formData = new FormData();
    if (editingNote) {
      formData.set("_action", "updateNote");
      formData.set("noteId", editingNote.id);
    } else {
      formData.set("_action", "addNote");
    }
    formData.set("content", noteContent.trim());
    formData.set("category", noteCategory);
    submit(formData, { method: "post" });
    setAddModalOpen(false);
  }, [noteContent, noteCategory, editingNote, submit]);

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      if (!confirm("Delete this note?")) return;
      const formData = new FormData();
      formData.set("_action", "deleteNote");
      formData.set("noteId", noteId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handlePinNote = useCallback(
    (noteId: string) => {
      const formData = new FormData();
      formData.set("_action", "pinNote");
      formData.set("noteId", noteId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handleSyncToShopify = useCallback(() => {
    const formData = new FormData();
    formData.set("_action", "syncToShopify");
    submit(formData, { method: "post" });
  }, [submit]);

  const categoryOptions = NOTE_CATEGORIES.map((c) => ({
    label: c.label,
    value: c.value,
  }));

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            Admin Notes ({notes.length})
          </Text>
          <InlineStack gap="200">
            {shopifyLinked && notes.some((n) => n.isPinned) && (
              <Button onClick={handleSyncToShopify} size="slim" loading={isSubmitting}>
                Sync to Shopify
              </Button>
            )}
            <Button variant="primary" onClick={handleOpenAdd} size="slim">
              Add Note
            </Button>
          </InlineStack>
        </InlineStack>

        {notes.length === 0 ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            No notes yet. Add notes about product preferences, family info, or other details.
          </Text>
        ) : (
          <BlockStack gap="200">
            {notes.map((note) => (
              <Box
                key={note.id}
                padding="300"
                background={note.isPinned ? "bg-surface-success" : "bg-surface-secondary"}
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <InlineStack gap="200" blockAlign="center">
                      {note.isPinned && (
                        <Text as="span" variant="bodySm" fontWeight="bold">
                          Pinned
                        </Text>
                      )}
                      {note.category && (
                        <Badge
                          tone={categoryBadgeTone(note.category)}
                          size="small"
                        >
                          {NOTE_CATEGORIES.find((c) => c.value === note.category)?.label || note.category}
                        </Badge>
                      )}
                      <Text as="span" variant="bodySm" tone="subdued">
                        {formatDate(note.createdAt)}
                      </Text>
                    </InlineStack>
                    <InlineStack gap="100">
                      <Button
                        onClick={() => handlePinNote(note.id)}
                        size="slim"
                        variant="plain"
                      >
                        {note.isPinned ? "Unpin" : "Pin"}
                      </Button>
                      <Button
                        onClick={() => handleOpenEdit(note)}
                        size="slim"
                        variant="plain"
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={() => handleDeleteNote(note.id)}
                        size="slim"
                        variant="plain"
                        tone="critical"
                      >
                        Delete
                      </Button>
                    </InlineStack>
                  </InlineStack>
                  <Text as="p" variant="bodyMd">
                    {note.content}
                  </Text>
                </BlockStack>
              </Box>
            ))}
          </BlockStack>
        )}
      </BlockStack>

      {/* Add/Edit Note Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title={editingNote ? "Edit Note" : "Add Note"}
        primaryAction={{
          content: editingNote ? "Save" : "Add",
          onAction: handleSaveNote,
          disabled: !noteContent.trim() || isSubmitting,
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setAddModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select
              label="Category"
              options={categoryOptions}
              value={noteCategory}
              onChange={setNoteCategory}
            />
            <TextField
              label="Note"
              value={noteContent}
              onChange={setNoteContent}
              multiline={4}
              autoComplete="off"
              maxLength={2000}
              showCharacterCount
              placeholder="Product preferences, family info, delivery notes..."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Card>
  );
}

// ============================================
// UTILITY HELPERS
// ============================================

function getStoreHandle(): string {
  // Extract store handle from the embedded app URL
  // In Shopify admin, window.location contains the store handle
  // For now, we use a static value — this is only for the "View in Shopify" link
  return "aheajv-fg";
}

function extractShopifyId(gid: string): string {
  // "gid://shopify/Customer/123456" → "123456"
  const parts = gid.split("/");
  return parts[parts.length - 1] || gid;
}
