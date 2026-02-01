import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Icon,
} from "@shopify/polaris";
import {
  CalendarIcon,
  ClockIcon,
  LocationIcon,
  NotificationIcon,
  SettingsIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

interface SettingsCardProps {
  title: string;
  description: string;
  href: string;
  icon: typeof CalendarIcon;
}

function SettingsCard({ title, description, href, icon }: SettingsCardProps) {
  return (
    <Link to={href} style={{ textDecoration: "none", color: "inherit" }}>
      <Card>
        <InlineStack gap="400" blockAlign="center">
          <Box
            background="bg-surface-secondary"
            padding="300"
            borderRadius="200"
          >
            <Icon source={icon} />
          </Box>
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              {title}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {description}
            </Text>
          </BlockStack>
        </InlineStack>
      </Card>
    </Link>
  );
}

export default function SettingsIndex() {
  return (
    <Page>
      <TitleBar title="Settings" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Pickup Configuration
            </Text>

            <SettingsCard
              title="Preparation Times"
              description="Configure cut-off times and lead days for order preparation"
              href="/app/settings/prep-times"
              icon={ClockIcon}
            />

            <SettingsCard
              title="Pickup Availability"
              description="Configure pickup days, time slots, and capacity limits"
              href="/app/settings/pickup-availability"
              icon={CalendarIcon}
            />

            <SettingsCard
              title="Pickup Locations"
              description="Manage pickup location names and addresses"
              href="/app/settings/locations"
              icon={LocationIcon}
            />

            <SettingsCard
              title="Blackout Dates"
              description="Block specific dates or time windows for holidays and closures"
              href="/app/settings/blackouts"
              icon={CalendarIcon}
            />

            <SettingsCard
              title="Subscriptions"
              description="Manage selling plans, billing, and subscription settings"
              href="/app/settings/subscriptions"
              icon={RefreshIcon}
            />
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Integrations
            </Text>

            <SettingsCard
              title="Google Calendar"
              description="Sync pickups to your Google Calendar"
              href="/app/settings/google-calendar"
              icon={CalendarIcon}
            />

            <SettingsCard
              title="Notifications"
              description="Configure SMS and email notifications for customers"
              href="/app/settings/notifications"
              icon={NotificationIcon}
            />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
