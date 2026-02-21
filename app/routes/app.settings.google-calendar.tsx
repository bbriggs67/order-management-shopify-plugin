import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  TextField,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  isGoogleCalendarConfigured,
  getGoogleAuthUrl,
  disconnectGoogleCalendar,
} from "../services/google-calendar.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const auth = await prisma.googleCalendarAuth.findUnique({
    where: { shop },
  });

  // Check if we have a Google OAuth error or success in the URL
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const success = url.searchParams.get("success");

  // Check if Google Calendar is configured
  const isConfigured = isGoogleCalendarConfigured();

  return json({
    shop,
    isConnected: !!auth,
    isConfigured,
    calendarId: auth?.calendarId || "primary",
    expiresAt: auth?.expiresAt?.toISOString() || null,
    error,
    success,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "disconnect") {
    await disconnectGoogleCalendar(shop);
    return json({ success: true });
  } else if (action === "updateCalendarId") {
    const calendarId = formData.get("calendarId") as string;
    await prisma.googleCalendarAuth.update({
      where: { shop },
      data: { calendarId },
    });
    return json({ success: true });
  } else if (action === "connect") {
    // Redirect to Google OAuth
    try {
      const authUrl = getGoogleAuthUrl(shop);
      return redirect(authUrl);
    } catch (error) {
      return json({ error: "Google Calendar is not configured" }, { status: 500 });
    }
  }

  return json({ success: true });
};

export default function GoogleCalendarSettings() {
  const { shop, isConnected, isConfigured, calendarId, expiresAt, error, success } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [editingCalendarId, setEditingCalendarId] = useState(false);
  const [newCalendarId, setNewCalendarId] = useState(calendarId);

  const handleConnect = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "connect");
    submit(formData, { method: "post" });
  }, [submit]);

  const handleDisconnect = useCallback(() => {
    if (
      confirm(
        "Are you sure you want to disconnect Google Calendar? Existing events will not be deleted from your calendar."
      )
    ) {
      const formData = new FormData();
      formData.append("_action", "disconnect");
      submit(formData, { method: "post" });
    }
  }, [submit]);

  const handleUpdateCalendarId = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "updateCalendarId");
    formData.append("calendarId", newCalendarId);
    submit(formData, { method: "post" });
    setEditingCalendarId(false);
  }, [newCalendarId, submit]);

  const formatExpiry = (dateString: string | null) => {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <Page backAction={{ content: "Settings", url: "/app/settings" }} title="Google Calendar">
      <TitleBar title="Google Calendar" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" title="Connection Error">
                <p>{decodeURIComponent(error)}</p>
              </Banner>
            )}

            {success && (
              <Banner tone="success" title="Connected">
                <p>Google Calendar has been connected successfully!</p>
              </Banner>
            )}

            {!isConfigured && (
              <Banner tone="warning" title="Configuration Required">
                <p>
                  Google Calendar integration requires environment variables to be set:
                  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.
                </p>
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Connection Status
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Sync pickup appointments to your Google Calendar
                    </Text>
                  </BlockStack>
                  {isConnected ? (
                    <Badge tone="success">Connected</Badge>
                  ) : (
                    <Badge tone="critical">Not Connected</Badge>
                  )}
                </InlineStack>

                <Divider />

                {isConnected ? (
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          Calendar ID
                        </Text>
                        {editingCalendarId ? (
                          <InlineStack gap="200">
                            <TextField
                              label="Calendar ID"
                              labelHidden
                              value={newCalendarId}
                              onChange={setNewCalendarId}
                              autoComplete="off"
                              placeholder="primary or calendar@example.com"
                            />
                            <Button onClick={handleUpdateCalendarId} loading={isLoading}>
                              Save
                            </Button>
                            <Button onClick={() => setEditingCalendarId(false)}>Cancel</Button>
                          </InlineStack>
                        ) : (
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              {calendarId}
                            </Text>
                            <Button size="slim" onClick={() => setEditingCalendarId(true)}>
                              Edit
                            </Button>
                          </InlineStack>
                        )}
                      </BlockStack>
                    </InlineStack>

                    {expiresAt && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd">
                          Token expires
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {formatExpiry(expiresAt)}
                        </Text>
                      </InlineStack>
                    )}

                    <Divider />

                    <Button tone="critical" onClick={handleDisconnect} loading={isLoading}>
                      Disconnect Google Calendar
                    </Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="400">
                    <Text as="p" variant="bodySm">
                      Connect your Google Calendar to automatically add pickup appointments as
                      events.
                    </Text>
                    <Button
                      variant="primary"
                      onClick={handleConnect}
                      loading={isLoading}
                      disabled={!isConfigured}
                    >
                      Connect Google Calendar
                    </Button>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {isConnected && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Sync Settings
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Configure how pickup events are synced to your calendar.
                  </Text>

                  <Divider />

                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        New pickup orders
                      </Text>
                      <Badge tone="success">Auto-sync enabled</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      New orders will automatically create calendar events
                    </Text>
                  </BlockStack>

                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Status changes
                      </Text>
                      <Badge tone="success">Auto-sync enabled</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Calendar events update when order status changes
                    </Text>
                  </BlockStack>

                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Cancellations
                      </Text>
                      <Badge tone="success">Auto-remove enabled</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Cancelled orders will remove calendar events
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  About Google Calendar
                </Text>
                <Text as="p" variant="bodySm">
                  Connecting your Google Calendar allows you to see all pickup appointments
                  alongside your other events.
                </Text>
                <Divider />
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  What gets synced:
                </Text>
                <Text as="p" variant="bodySm">
                  • New pickup orders
                </Text>
                <Text as="p" variant="bodySm">
                  • Order status changes
                </Text>
                <Text as="p" variant="bodySm">
                  • Subscription pickups
                </Text>
                <Text as="p" variant="bodySm">
                  • Cancellations
                </Text>
                <Divider />
                <Text as="p" variant="bodySm">
                  Event titles include customer name, order number, and pickup time slot.
                </Text>
              </BlockStack>
            </Card>

            {!isConfigured && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Setup Instructions
                  </Text>
                  <Text as="p" variant="bodySm">
                    To enable Google Calendar integration:
                  </Text>
                  <Text as="p" variant="bodySm">
                    1. Create a project in Google Cloud Console
                  </Text>
                  <Text as="p" variant="bodySm">
                    2. Enable the Google Calendar API
                  </Text>
                  <Text as="p" variant="bodySm">
                    3. Create OAuth 2.0 credentials
                  </Text>
                  <Text as="p" variant="bodySm">
                    4. Add these environment variables:
                  </Text>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      GOOGLE_CLIENT_ID
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      GOOGLE_CLIENT_SECRET
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      GOOGLE_REDIRECT_URI
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
