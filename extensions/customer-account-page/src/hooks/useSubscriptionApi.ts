import { useApi } from "@shopify/ui-extensions-react/customer-account";
import type { SubscriptionData, ActionResult } from "../types";

export function useSubscriptionApi() {
  const { sessionToken, extension } = useApi<"customer-account.page.render">();

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await sessionToken.get();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function fetchSubscriptions(): Promise<SubscriptionData> {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${extension.appUrl}/api/customer-subscriptions`,
      { headers }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || errorData.message || `HTTP ${response.status}`
      );
    }

    return response.json();
  }

  async function performAction(
    action: string,
    subscriptionId: string,
    params: Record<string, unknown> = {}
  ): Promise<ActionResult> {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${extension.appUrl}/api/customer-subscriptions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          action,
          subscriptionId,
          ...params,
        }),
      }
    );

    if (!response.ok && response.status !== 400) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  return { fetchSubscriptions, performAction };
}
