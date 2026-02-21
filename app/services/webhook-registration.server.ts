/**
 * Webhook Registration Service
 * Programmatically registers webhooks via GraphQL API
 * This bypasses issues with declarative webhooks not updating on existing installations
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

interface WebhookConfig {
  topic: string;
  uri: string;
}

const REQUIRED_WEBHOOKS: WebhookConfig[] = [
  { topic: "ORDERS_CREATE", uri: "/webhooks/orders/create" },
  { topic: "ORDERS_UPDATED", uri: "/webhooks/orders/updated" },
  { topic: "ORDERS_CANCELLED", uri: "/webhooks/orders/cancelled" },
  { topic: "SUBSCRIPTION_CONTRACTS_CREATE", uri: "/webhooks/subscription_contracts/create" },
  { topic: "SUBSCRIPTION_CONTRACTS_UPDATE", uri: "/webhooks/subscription_contracts/update" },
  { topic: "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS", uri: "/webhooks/subscription_billing_attempts/success" },
  { topic: "SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE", uri: "/webhooks/subscription_billing_attempts/failure" },
];

interface WebhookSubscription {
  id: string;
  topic: string;
  endpoint: {
    __typename: string;
    callbackUrl?: string;
  };
}

interface RegisterResult {
  success: boolean;
  registered: string[];
  alreadyExists: string[];
  failed: { topic: string; error: string }[];
}

/**
 * Get the app URL from environment
 */
function getAppUrl(): string {
  const url = process.env.SHOPIFY_APP_URL;
  if (!url) {
    throw new Error("SHOPIFY_APP_URL environment variable is not set");
  }
  return url;
}

/**
 * List all existing webhook subscriptions for the app
 */
export async function listWebhooks(admin: AdminApiContext): Promise<WebhookSubscription[]> {
  const response = await admin.graphql(`
    query getWebhooks {
      webhookSubscriptions(first: 50) {
        nodes {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  return data.data?.webhookSubscriptions?.nodes || [];
}

/**
 * Register a single webhook subscription
 */
async function registerWebhook(
  admin: AdminApiContext,
  topic: string,
  callbackUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await admin.graphql(`
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        topic,
        webhookSubscription: {
          callbackUrl,
          format: "JSON",
        },
      },
    });

    const data = await response.json();

    if (data.data?.webhookSubscriptionCreate?.userErrors?.length > 0) {
      const errors = data.data.webhookSubscriptionCreate.userErrors;
      return {
        success: false,
        error: errors.map((e: { message: string }) => e.message).join(", ")
      };
    }

    if (data.data?.webhookSubscriptionCreate?.webhookSubscription) {
      return { success: true };
    }

    return { success: false, error: "Unknown error" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Delete a webhook subscription
 */
export async function deleteWebhook(
  admin: AdminApiContext,
  webhookId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await admin.graphql(`
      mutation webhookSubscriptionDelete($id: ID!) {
        webhookSubscriptionDelete(id: $id) {
          deletedWebhookSubscriptionId
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: { id: webhookId },
    });

    const data = await response.json();

    if (data.data?.webhookSubscriptionDelete?.userErrors?.length > 0) {
      const errors = data.data.webhookSubscriptionDelete.userErrors;
      return {
        success: false,
        error: errors.map((e: { message: string }) => e.message).join(", ")
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Register all required webhooks for the app
 * Skips webhooks that already exist with the correct URL
 */
export async function registerAllWebhooks(admin: AdminApiContext): Promise<RegisterResult> {
  const appUrl = getAppUrl();
  const result: RegisterResult = {
    success: true,
    registered: [],
    alreadyExists: [],
    failed: [],
  };

  // Get existing webhooks
  const existingWebhooks = await listWebhooks(admin);
  console.log(`Found ${existingWebhooks.length} existing webhooks`);

  // Map existing webhooks by topic for easy lookup
  const existingByTopic = new Map<string, WebhookSubscription>();
  for (const webhook of existingWebhooks) {
    existingByTopic.set(webhook.topic, webhook);
  }

  // Register each required webhook
  for (const config of REQUIRED_WEBHOOKS) {
    const callbackUrl = `${appUrl}${config.uri}`;
    const existing = existingByTopic.get(config.topic);

    if (existing) {
      // Check if the URL matches
      const existingUrl = existing.endpoint?.callbackUrl;
      if (existingUrl === callbackUrl) {
        console.log(`Webhook ${config.topic} already exists with correct URL`);
        result.alreadyExists.push(config.topic);
        continue;
      } else {
        // URL doesn't match - delete and recreate
        console.log(`Webhook ${config.topic} exists but URL mismatch. Deleting and recreating...`);
        console.log(`  Existing: ${existingUrl}`);
        console.log(`  Expected: ${callbackUrl}`);

        const deleteResult = await deleteWebhook(admin, existing.id);
        if (!deleteResult.success) {
          console.error(`Failed to delete webhook ${config.topic}: ${deleteResult.error}`);
          result.failed.push({ topic: config.topic, error: `Delete failed: ${deleteResult.error}` });
          result.success = false;
          continue;
        }
      }
    }

    // Register the webhook
    console.log(`Registering webhook ${config.topic} -> ${callbackUrl}`);
    const registerResult = await registerWebhook(admin, config.topic, callbackUrl);

    if (registerResult.success) {
      console.log(`Successfully registered webhook ${config.topic}`);
      result.registered.push(config.topic);
    } else {
      console.error(`Failed to register webhook ${config.topic}: ${registerResult.error}`);
      result.failed.push({ topic: config.topic, error: registerResult.error || "Unknown error" });
      result.success = false;
    }
  }

  return result;
}

/**
 * Check webhook health - returns status of all required webhooks
 */
export async function checkWebhookHealth(admin: AdminApiContext): Promise<{
  healthy: boolean;
  missing: string[];
  registered: string[];
  wrongUrl: string[];
}> {
  const appUrl = getAppUrl();
  const existingWebhooks = await listWebhooks(admin);

  const existingByTopic = new Map<string, WebhookSubscription>();
  for (const webhook of existingWebhooks) {
    existingByTopic.set(webhook.topic, webhook);
  }

  const missing: string[] = [];
  const registered: string[] = [];
  const wrongUrl: string[] = [];

  for (const config of REQUIRED_WEBHOOKS) {
    const expectedUrl = `${appUrl}${config.uri}`;
    const existing = existingByTopic.get(config.topic);

    if (!existing) {
      missing.push(config.topic);
    } else if (existing.endpoint?.callbackUrl !== expectedUrl) {
      wrongUrl.push(config.topic);
    } else {
      registered.push(config.topic);
    }
  }

  return {
    healthy: missing.length === 0 && wrongUrl.length === 0,
    missing,
    registered,
    wrongUrl,
  };
}
