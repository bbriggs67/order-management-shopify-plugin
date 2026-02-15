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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get all registered webhooks
  const webhooks = await listWebhooks(admin);

  // Get webhook health
  const health = await checkWebhookHealth(admin);

  // Get app URL from env
  const appUrl = process.env.SHOPIFY_APP_URL || "https://order-management-shopify-plugin-production.up.railway.app";

  return json({
    shop,
    webhooks,
    health,
    appUrl,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "register_all") {
    const result = await registerAllWebhooks(admin);
    return json({
      success: result.success,
      result,
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function WebhookDebug() {
  const { shop, webhooks, health, appUrl } = useLoaderData<typeof loader>();
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
