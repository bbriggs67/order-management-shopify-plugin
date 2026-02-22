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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listWebhooks, registerAllWebhooks, checkWebhookHealth } from "../services/webhook-registration.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get all registered webhooks
  const webhooks = await listWebhooks(admin);

  // Get webhook health
  const health = await checkWebhookHealth(admin);

  // Get app URL from env
  const appUrl = process.env.SHOPIFY_APP_URL || "(SHOPIFY_APP_URL not set)";

  // Get recent webhook events from database
  const recentWebhookEvents = await prisma.webhookEvent.findMany({
    where: { shop },
    orderBy: { processedAt: "desc" },
    take: 10,
  });

  // Check for sessions
  const sessions = await prisma.session.findMany({
    where: { shop },
    select: {
      id: true,
      isOnline: true,
      scope: true,
      expires: true,
    },
  });

  return json({
    shop,
    webhooks,
    health,
    appUrl,
    recentWebhookEvents,
    sessions,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "register_all") {
    const result = await registerAllWebhooks(admin);
    return json({
      success: result.success,
      result,
    });
  }

  if (intent === "delete_webhook_event") {
    // Delete a WebhookEvent so the order can be reprocessed on next webhook delivery.
    // With the updated webhook handler, orders without a PickupSchedule will be
    // reprocessed even if the WebhookEvent exists, but deleting it provides a clean slate.
    const eventId = formData.get("eventId") as string;
    const event = await prisma.webhookEvent.findFirst({
      where: { id: eventId, shop },
    });
    if (event) {
      await prisma.webhookEvent.delete({ where: { id: eventId } });
      return json({
        success: true,
        message: `Deleted WebhookEvent for order ${event.shopifyId}. The order will be reprocessed on next webhook delivery, or you can trigger a reprocess by fetching the order via GraphQL.`,
      });
    }
    return json({ error: "WebhookEvent not found" }, { status: 404 });
  }

  if (intent === "view_payload") {
    const eventId = formData.get("eventId") as string;
    const event = await prisma.webhookEvent.findFirst({
      where: { id: eventId, shop },
    });
    if (event) {
      return json({
        viewPayload: true,
        event: {
          id: event.id,
          topic: event.topic,
          shopifyId: event.shopifyId,
          processedAt: event.processedAt,
          payload: event.payload,
        },
      });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function WebhookDebug() {
  const { shop, webhooks, health, appUrl, recentWebhookEvents, sessions } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const webhookRows = webhooks.map((webhook: any) => [
    webhook.topic,
    webhook.endpoint?.callbackUrl || "N/A",
    webhook.endpoint?.__typename || "Unknown",
    webhook.id,
  ]);

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Webhook Debug"
    >
      <TitleBar title="Webhook Debug" />

      <Layout>
        {actionData && "success" in actionData && (
          <Layout.Section>
            <Banner tone={actionData.success ? "success" : "critical"}>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
                {JSON.stringify(actionData.result, null, 2)}
              </pre>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Configuration</Text>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" fontWeight="semibold">Shop:</Text>
                  <Text as="span">{shop}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" fontWeight="semibold">App URL:</Text>
                  <Text as="span">{appUrl}</Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Webhook Health</Text>
                <Badge tone={health.healthy ? "success" : "critical"}>
                  {health.healthy ? "Healthy" : "Issues Detected"}
                </Badge>
              </InlineStack>

              {health.missing.length > 0 && (
                <Banner tone="warning">
                  <Text as="p" fontWeight="semibold">Missing webhooks:</Text>
                  <Text as="p">{health.missing.join(", ")}</Text>
                </Banner>
              )}

              {health.wrongUrl.length > 0 && (
                <Banner tone="warning">
                  <Text as="p" fontWeight="semibold">Wrong URL webhooks:</Text>
                  <Text as="p">{health.wrongUrl.join(", ")}</Text>
                </Banner>
              )}

              {health.registered.length > 0 && (
                <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                  <Text as="p" tone="subdued">
                    Registered ({health.registered.length}): {health.registered.join(", ")}
                  </Text>
                </Box>
              )}

              <Button
                variant="primary"
                onClick={() => {
                  const formData = new FormData();
                  formData.append("intent", "register_all");
                  submit(formData, { method: "post" });
                }}
                loading={isLoading}
              >
                Re-register All Webhooks
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Registered Webhooks ({webhooks.length})
              </Text>

              {webhooks.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Topic", "Callback URL", "Type", "ID"]}
                  rows={webhookRows}
                />
              ) : (
                <Banner tone="warning">
                  No webhooks are currently registered for this store.
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Test Webhook Endpoint</Text>
              <Text as="p" tone="subdued">
                Use these links to verify the webhook endpoints are reachable:
              </Text>
              <BlockStack gap="100">
                <Text as="p">
                  <a href={`${appUrl}/webhooks/health`} target="_blank" rel="noopener noreferrer">
                    {appUrl}/webhooks/health
                  </a>
                  {" "}- Should return JSON with status "healthy"
                </Text>
                <Text as="p">
                  <a href={`${appUrl}/webhooks/debug`} target="_blank" rel="noopener noreferrer">
                    {appUrl}/webhooks/debug
                  </a>
                  {" "}- Debug endpoint for testing
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Session Status</Text>
              {sessions.length > 0 ? (
                <BlockStack gap="200">
                  {sessions.map((session: any) => (
                    <Box key={session.id} padding="200" background="bg-surface-secondary" borderRadius="100">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Badge tone={session.isOnline ? "attention" : "success"}>
                            {session.isOnline ? "Online" : "Offline"}
                          </Badge>
                          <Text as="span" variant="bodySm">ID: {session.id.substring(0, 20)}...</Text>
                        </InlineStack>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Scopes: {session.scope || "none"}
                        </Text>
                        {session.expires && (
                          <Text as="p" tone="subdued" variant="bodySm">
                            Expires: {new Date(session.expires).toLocaleString()}
                          </Text>
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              ) : (
                <Banner tone="critical">
                  No sessions found for this shop. This might explain webhook authentication failures.
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {actionData && "viewPayload" in actionData && actionData.viewPayload && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Webhook Payload Details</Text>
                  <Badge>{actionData.event.topic}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">Shopify ID: {actionData.event.shopifyId}</Text>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: "11px", maxHeight: "400px", overflow: "auto" }}>
                    {actionData.event.payload && Object.keys(actionData.event.payload).length === 0
                      ? "Payload stripped (new events no longer store full payloads)"
                      : JSON.stringify(actionData.event.payload, null, 2)}
                  </pre>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recent Webhook Events ({recentWebhookEvents.length})
              </Text>
              <Text as="p" tone="subdued">
                Shows webhooks that were successfully processed and stored in the database. Click "View Payload" to see what data was received.
              </Text>

              {recentWebhookEvents.length > 0 ? (
                <BlockStack gap="200">
                  {recentWebhookEvents.map((event: any) => (
                    <Box key={event.id} padding="200" background="bg-surface-secondary" borderRadius="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200">
                            <Badge>{event.topic}</Badge>
                            <Text as="span" variant="bodySm">ID: {event.shopifyId}</Text>
                          </InlineStack>
                          <Text as="p" tone="subdued" variant="bodySm">
                            {new Date(event.processedAt).toLocaleString()}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            onClick={() => {
                              const formData = new FormData();
                              formData.append("intent", "view_payload");
                              formData.append("eventId", event.id);
                              submit(formData, { method: "post" });
                            }}
                          >
                            View Payload
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => {
                              if (confirm("Delete this WebhookEvent? This allows the order to be reprocessed.")) {
                                const formData = new FormData();
                                formData.append("intent", "delete_webhook_event");
                                formData.append("eventId", event.id);
                                submit(formData, { method: "post" });
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              ) : (
                <Banner tone="warning">
                  No webhook events have been processed yet. If you placed orders, this means webhooks are NOT being received or are failing authentication.
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Troubleshooting</Text>
              <Text as="p" tone="subdued">
                If webhooks show as registered but orders aren't syncing:
              </Text>
              <BlockStack gap="100">
                <Text as="p">1. Check that the Callback URL matches the App URL above</Text>
                <Text as="p">2. Click the health check links above to verify endpoints are reachable</Text>
                <Text as="p">3. Verify Railway deployment is active and healthy</Text>
                <Text as="p">4. Check Shopify Partners Dashboard → Apps → Susies Sourdough Manager → Insights → Webhook metrics</Text>
                <Text as="p">5. Look for failed deliveries or error codes in the webhook metrics</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
