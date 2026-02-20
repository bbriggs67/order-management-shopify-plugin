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

interface CustomerSubscription {
  id: string;
  status: string;
  frequency: string;
  preferredDay: number;
  preferredTimeSlot: string;
  discountPercent: number;
  nextPickupDate: string | null;
}

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
  const { sessionToken, extension } = useApi<"customer-account.profile.block.render">();
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
      const appUrl = extension.appUrl;

      const response = await fetch(
        `${appUrl}/api/customer-subscriptions`,
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
            {DAY_NAMES[sub.preferredDay]} Pickup ({sub.frequency.toLowerCase()})
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
