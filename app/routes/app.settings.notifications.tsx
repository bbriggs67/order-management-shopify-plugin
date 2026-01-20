import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
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

  await prisma.notificationSettings.upsert({
    where: { shop },
    create: {
      shop,
      smsEnabled: data.smsEnabled === "true",
      emailEnabled: data.emailEnabled === "true",
      smsTemplate: data.smsTemplate as string,
      emailSubject: data.emailSubject as string,
      emailTemplate: data.emailTemplate as string,
    },
    update: {
      smsEnabled: data.smsEnabled === "true",
      emailEnabled: data.emailEnabled === "true",
      smsTemplate: data.smsTemplate as string,
      emailSubject: data.emailSubject as string,
      emailTemplate: data.emailTemplate as string,
    },
  });

  return json({ success: true });
};

export default function NotificationsSettings() {
  const { settings, hasTwilioConfig, hasSendGridConfig } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [smsEnabled, setSmsEnabled] = useState(settings.smsEnabled);
  const [emailEnabled, setEmailEnabled] = useState(settings.emailEnabled);
  const [smsTemplate, setSmsTemplate] = useState(settings.smsTemplate);
  const [emailSubject, setEmailSubject] = useState(settings.emailSubject);
  const [emailTemplate, setEmailTemplate] = useState(settings.emailTemplate || DEFAULT_EMAIL_TEMPLATE);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("smsEnabled", smsEnabled.toString());
    formData.append("emailEnabled", emailEnabled.toString());
    formData.append("smsTemplate", smsTemplate);
    formData.append("emailSubject", emailSubject);
    formData.append("emailTemplate", emailTemplate);
    submit(formData, { method: "post" });
  }, [smsEnabled, emailEnabled, smsTemplate, emailSubject, emailTemplate, submit]);

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
