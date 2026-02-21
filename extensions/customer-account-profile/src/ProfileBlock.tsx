import {
  reactExtension,
  useApi,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  Heading,
  Divider,
} from "@shopify/ui-extensions-react/customer-account";
import { useState, useEffect } from "react";

// NOTE: This interface mirrors CustomerSubscription from customer-account-page/src/types.ts.
// These are separate Shopify extensions with isolated build contexts, so we can't share imports.
// Keep in sync with the canonical types.ts if fields change.
interface CustomerSubscription {
  id: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";
  preferredDay: number; // 0-6 (Sun-Sat)
  preferredTimeSlot: string;
  discountPercent: number;
  nextPickupDate: string | null;
}

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "weekly",
  BIWEEKLY: "every 2 weeks",
  TRIWEEKLY: "every 3 weeks",
};

// Customer account extensions don't have extension.appUrl (unlike checkout extensions).
const APP_URL = "https://order-management-shopify-plugin-production.up.railway.app";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default reactExtension(
  "customer-account.profile.block.render",
  () => <ProfileBlock />
);

function ProfileBlock() {
  const { sessionToken } = useApi<"customer-account.profile.block.render">();
  const [subscriptions, setSubscriptions] = useState<CustomerSubscription[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  async function fetchSubscriptions() {
    try {
      setLoading(true);
      setError(null);

      const token = await sessionToken.get();

      const response = await fetch(
        `${APP_URL}/api/customer-subscriptions`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setSubscriptions(data.subscriptions || []);
    } catch (err) {
      console.error("Failed to fetch subscriptions:", err);
      setError("Unable to load subscriptions");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <BlockStack spacing="base">
        <Heading level={2}>My Subscriptions</Heading>
        <Text>Loading...</Text>
      </BlockStack>
    );
  }

  if (error) {
    return (
      <BlockStack spacing="base">
        <Heading level={2}>My Subscriptions</Heading>
        <Banner status="critical">{error}</Banner>
      </BlockStack>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <BlockStack spacing="base">
        <Heading level={2}>My Subscriptions</Heading>
        <Text>No active subscriptions.</Text>
        <Text appearance="subdued">
          Browse our products to start a Subscribe & Save plan!
        </Text>
      </BlockStack>
    );
  }

  const activeCount = subscriptions.filter(
    (s) => s.status === "ACTIVE"
  ).length;
  const pausedCount = subscriptions.filter(
    (s) => s.status === "PAUSED"
  ).length;

  return (
    <BlockStack spacing="base">
      <Heading level={2}>My Subscriptions</Heading>

      {subscriptions.map((sub) => (
        <InlineStack key={sub.id} spacing="base" blockAlignment="center">
          <Badge
            status={sub.status === "ACTIVE" ? "success" : "warning"}
          >
            {sub.status}
          </Badge>
          <Text>
            {DAY_NAMES[sub.preferredDay]} Pickup ({FREQUENCY_LABELS[sub.frequency] || sub.frequency.toLowerCase()})
          </Text>
        </InlineStack>
      ))}

      <Divider />

      <InlineStack spacing="base" blockAlignment="center">
        <Text appearance="subdued">
          {activeCount} active{pausedCount > 0 ? `, ${pausedCount} paused` : ""}
        </Text>
      </InlineStack>

      <Button
        kind="secondary"
        to="extension:sub-manager-page/"
      >
        Manage Subscriptions
      </Button>
    </BlockStack>
  );
}
