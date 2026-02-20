import {
  reactExtension,
  useApi,
  Page,
  BlockStack,
  Text,
  Banner,
  Heading,
} from "@shopify/ui-extensions-react/customer-account";
import { useState, useEffect, useCallback } from "react";
import type {
  CustomerSubscription,
  AvailableTimeSlot,
  ActionResult,
} from "./types";
import { useSubscriptionApi } from "./hooks/useSubscriptionApi";
import { SubscriptionCard } from "./components/SubscriptionCard";

export default reactExtension(
  "customer-account.page.render",
  () => <SubscriptionPage />
);

function SubscriptionPage() {
  const api = useSubscriptionApi();

  const [subscriptions, setSubscriptions] = useState<CustomerSubscription[]>(
    []
  );
  const [availableDays, setAvailableDays] = useState<number[]>([]);
  const [availableTimeSlots, setAvailableTimeSlots] = useState<
    AvailableTimeSlot[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const data = await api.fetchSubscriptions();
      setSubscriptions(data.subscriptions || []);
      setAvailableDays(data.availableDays || []);
      setAvailableTimeSlots(data.availableTimeSlots || []);
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load subscriptions"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleAction(
    action: string,
    subscriptionId: string,
    params: Record<string, unknown> = {}
  ): Promise<ActionResult> {
    return api.performAction(action, subscriptionId, params);
  }

  async function handleRefresh() {
    await loadData();
  }

  if (loading) {
    return (
      <Page title="My Subscriptions">
        <BlockStack spacing="base">
          <Text>Loading your subscriptions...</Text>
        </BlockStack>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="My Subscriptions">
        <BlockStack spacing="base">
          <Banner status="critical">
            {error}
          </Banner>
          <Text appearance="subdued">
            Please try refreshing the page. If the problem persists, contact
            us for help.
          </Text>
        </BlockStack>
      </Page>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <Page title="My Subscriptions">
        <BlockStack spacing="base">
          <Text>You don't have any active subscriptions.</Text>
          <Text appearance="subdued">
            Browse our products to start a Subscribe & Save plan and enjoy
            automatic discounts on every pickup!
          </Text>
        </BlockStack>
      </Page>
    );
  }

  const pageTitle =
    subscriptions.length > 1 ? "My Subscriptions" : "My Subscription";

  return (
    <Page title={pageTitle}>
      <BlockStack spacing="loose">
        {subscriptions.map((sub) => (
          <SubscriptionCard
            key={sub.id}
            subscription={sub}
            availableDays={availableDays}
            availableTimeSlots={availableTimeSlots}
            onAction={handleAction}
            onRefresh={handleRefresh}
          />
        ))}
      </BlockStack>
    </Page>
  );
}
