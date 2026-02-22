import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Badge,
  Checkbox,
  Divider,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { normalizePhone } from "../utils/phone.server";

const DEFAULT_SMS_TEMPLATE = "Hi {name}! Your Susie's Sourdough order #{number} is ready for pickup at {location}. Time slot: {time_slot}";
const DEFAULT_EMAIL_SUBJECT = "Your Susie's Sourdough Order is Ready!";
const DEFAULT_EMAIL_TEMPLATE = `<p>Hi {name},</p>
<p>Great news! Your order <strong>#{number}</strong> is ready for pickup.</p>
<p><strong>Pickup Details:</strong></p>
<ul>
  <li>Location: {location}</li>
  <li>Date: {date}</li>
  <li>Time Slot: {time_slot}</li>
</ul>
<p>We look forward to seeing you!</p>
<p>- Susie's Sourdough</p>`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.notificationSettings.findUnique({
    where: { shop },
  });

  // Create default settings if none exist
  if (!settings) {
    settings = await prisma.notificationSettings.create({
      data: {
        shop,
        smsEnabled: true,
        emailEnabled: true,
        smsTemplate: DEFAULT_SMS_TEMPLATE,
        emailSubject: DEFAULT_EMAIL_SUBJECT,
        emailTemplate: DEFAULT_EMAIL_TEMPLATE,
      },
    });
  }

  // Check for environment variables (Twilio and SendGrid credentials)
  const hasTwilioConfig = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
  const hasSendGridConfig = !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);

  return json({
    settings,
    hasTwilioConfig,
    hasSendGridConfig,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  // Validate SMS forwarding phone if forwarding is enabled
  const smsForwardingEnabled = data.smsForwardingEnabled === "true";
  const smsForwardingPhoneRaw = (data.smsForwardingPhone as string || "").trim();
  let smsForwardingPhone: string | null = null;

  if (smsForwardingEnabled) {
    if (!smsForwardingPhoneRaw) {
      return json({ success: false, error: "Forwarding phone number is required when forwarding is enabled" });
    }
    const normalized = normalizePhone(smsForwardingPhoneRaw);
    if (!normalized) {
      return json({ success: false, error: "Invalid forwarding phone number. Use format: (858) 555-1234 or +18585551234" });
    }
    smsForwardingPhone = normalized;
  } else if (smsForwardingPhoneRaw) {
    // Save the phone even if forwarding is off, so it's pre-filled when re-enabled
    smsForwardingPhone = normalizePhone(smsForwardingPhoneRaw) || smsForwardingPhoneRaw;
  }

  await prisma.notificationSettings.upsert({
    where: { shop },
    create: {
      shop,
      smsEnabled: data.smsEnabled === "true",
      emailEnabled: data.emailEnabled === "true",
      smsTemplate: data.smsTemplate as string,
      emailSubject: data.emailSubject as string,
      emailTemplate: data.emailTemplate as string,
      smsForwardingEnabled,
      smsForwardingPhone,
    },
    update: {
      smsEnabled: data.smsEnabled === "true",
      emailEnabled: data.emailEnabled === "true",
      smsTemplate: data.smsTemplate as string,
      emailSubject: data.emailSubject as string,
      emailTemplate: data.emailTemplate as string,
      smsForwardingEnabled,
      smsForwardingPhone,
    },
  });

  return json({ success: true });
};

export default function NotificationsSettings() {
  const { settings, hasTwilioConfig, hasSendGridConfig } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success?: boolean; error?: string }>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [smsEnabled, setSmsEnabled] = useState(settings.smsEnabled);
  const [emailEnabled, setEmailEnabled] = useState(settings.emailEnabled);
  const [smsTemplate, setSmsTemplate] = useState(settings.smsTemplate);
  const [emailSubject, setEmailSubject] = useState(settings.emailSubject);
  const [emailTemplate, setEmailTemplate] = useState(settings.emailTemplate || DEFAULT_EMAIL_TEMPLATE);
  const [smsForwardingEnabled, setSmsForwardingEnabled] = useState(settings.smsForwardingEnabled ?? false);
  const [smsForwardingPhone, setSmsForwardingPhone] = useState(settings.smsForwardingPhone || "");

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("smsEnabled", smsEnabled.toString());
    formData.append("emailEnabled", emailEnabled.toString());
    formData.append("smsTemplate", smsTemplate);
    formData.append("emailSubject", emailSubject);
    formData.append("emailTemplate", emailTemplate);
    formData.append("smsForwardingEnabled", smsForwardingEnabled.toString());
    formData.append("smsForwardingPhone", smsForwardingPhone);
    submit(formData, { method: "post" });
  }, [smsEnabled, emailEnabled, smsTemplate, emailSubject, emailTemplate, smsForwardingEnabled, smsForwardingPhone, submit]);

  const handleResetSms = useCallback(() => {
    setSmsTemplate(DEFAULT_SMS_TEMPLATE);
  }, []);

  const handleResetEmail = useCallback(() => {
    setEmailSubject(DEFAULT_EMAIL_SUBJECT);
    setEmailTemplate(DEFAULT_EMAIL_TEMPLATE);
  }, []);

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Notifications"
    >
      <TitleBar title="Notifications" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.error && (
              <Banner tone="critical">
                <p>{actionData.error}</p>
              </Banner>
            )}

            <Banner tone="info">
              <p>
                Notifications are sent when you mark an order as "Ready" for pickup.
                SMS is preferred if the customer provided a phone number, otherwise email is used.
              </p>
            </Banner>

            {/* SMS Settings */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      SMS Notifications (Twilio)
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Send text messages when orders are ready
                    </Text>
                  </BlockStack>
                  {hasTwilioConfig ? (
                    <Badge tone="success">Configured</Badge>
                  ) : (
                    <Badge tone="warning">Not Configured</Badge>
                  )}
                </InlineStack>

                <Divider />

                {!hasTwilioConfig && (
                  <Banner tone="warning">
                    <p>
                      Twilio credentials not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
                      and TWILIO_PHONE_NUMBER to your environment variables.
                    </p>
                  </Banner>
                )}

                <Checkbox
                  label="Enable SMS notifications"
                  checked={smsEnabled}
                  onChange={setSmsEnabled}
                  disabled={!hasTwilioConfig}
                  helpText={hasTwilioConfig ? "Send SMS when orders are marked as ready" : "Configure Twilio to enable SMS"}
                />

                {smsEnabled && hasTwilioConfig && (
                  <>
                    <TextField
                      label="SMS template"
                      value={smsTemplate}
                      onChange={setSmsTemplate}
                      multiline={3}
                      autoComplete="off"
                      helpText="Available variables: {name}, {number}, {location}, {date}, {time_slot}"
                    />
                    <InlineStack align="end">
                      <Button size="slim" onClick={handleResetSms}>
                        Reset to default
                      </Button>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>

            {/* Email Settings */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Email Notifications (SendGrid)
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Send emails when orders are ready (fallback if no phone)
                    </Text>
                  </BlockStack>
                  {hasSendGridConfig ? (
                    <Badge tone="success">Configured</Badge>
                  ) : (
                    <Badge tone="warning">Not Configured</Badge>
                  )}
                </InlineStack>

                <Divider />

                {!hasSendGridConfig && (
                  <Banner tone="warning">
                    <p>
                      SendGrid credentials not configured. Add SENDGRID_API_KEY and
                      SENDGRID_FROM_EMAIL to your environment variables.
                    </p>
                  </Banner>
                )}

                <Checkbox
                  label="Enable email notifications"
                  checked={emailEnabled}
                  onChange={setEmailEnabled}
                  disabled={!hasSendGridConfig}
                  helpText={hasSendGridConfig ? "Send email when SMS is not available" : "Configure SendGrid to enable email"}
                />

                {emailEnabled && hasSendGridConfig && (
                  <>
                    <TextField
                      label="Email subject"
                      value={emailSubject}
                      onChange={setEmailSubject}
                      autoComplete="off"
                      helpText="Available variables: {name}, {number}"
                    />
                    <TextField
                      label="Email template (HTML)"
                      value={emailTemplate}
                      onChange={setEmailTemplate}
                      multiline={10}
                      autoComplete="off"
                      helpText="Available variables: {name}, {number}, {location}, {date}, {time_slot}"
                    />
                    <InlineStack align="end">
                      <Button size="slim" onClick={handleResetEmail}>
                        Reset to default
                      </Button>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>

            {/* SMS Forwarding */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      SMS Forwarding
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Forward incoming customer texts to your personal phone
                    </Text>
                  </BlockStack>
                  {smsForwardingEnabled && hasTwilioConfig ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge>Inactive</Badge>
                  )}
                </InlineStack>

                <Divider />

                {!hasTwilioConfig && (
                  <Banner tone="warning">
                    <p>
                      Twilio credentials must be configured before enabling SMS forwarding.
                    </p>
                  </Banner>
                )}

                <Checkbox
                  label="Forward incoming customer texts"
                  checked={smsForwardingEnabled}
                  onChange={setSmsForwardingEnabled}
                  disabled={!hasTwilioConfig}
                  helpText={
                    hasTwilioConfig
                      ? "When a customer texts your Twilio number, forward the message to your phone"
                      : "Configure Twilio to enable SMS forwarding"
                  }
                />

                {smsForwardingEnabled && hasTwilioConfig && (
                  <TextField
                    label="Forwarding phone number"
                    value={smsForwardingPhone}
                    onChange={setSmsForwardingPhone}
                    autoComplete="tel"
                    placeholder="(858) 555-1234"
                    helpText="Your personal phone number. Messages arrive as: [SSMA] New text from Customer Name: ..."
                  />
                )}
              </BlockStack>
            </Card>

            <InlineStack align="end">
              <Button variant="primary" onClick={handleSave} loading={isLoading}>
                Save
              </Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  How Notifications Work
                </Text>
                <Text as="p" variant="bodySm">
                  When you mark an order as "Ready" for pickup:
                </Text>
                <Text as="p" variant="bodySm">
                  1. If customer has phone → SMS is sent
                </Text>
                <Text as="p" variant="bodySm">
                  2. If no phone → Email is sent
                </Text>
                <Text as="p" variant="bodySm">
                  3. If neither → No notification
                </Text>
                <Divider />
                <Text as="h3" variant="headingSm">SMS Forwarding</Text>
                <Text as="p" variant="bodySm">
                  When enabled, customer texts to your Twilio number are forwarded to your phone as notifications. Reply via the CRM conversation thread to respond from the business number.
                </Text>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  All notification attempts are logged for your records.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Template Variables
                </Text>
                <Text as="p" variant="bodySm">
                  Use these in your templates:
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    <strong>{"{name}"}</strong> - Customer's name
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>{"{number}"}</strong> - Order number
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>{"{location}"}</strong> - Pickup location
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>{"{date}"}</strong> - Pickup date
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>{"{time_slot}"}</strong> - Time window
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
