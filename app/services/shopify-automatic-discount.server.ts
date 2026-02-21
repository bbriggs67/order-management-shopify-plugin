/**
 * Shopify Automatic Discount Service
 *
 * Creates and manages the automatic discount linked to the
 * subscription-discount Shopify Function extension.
 *
 * The Function reads cart attributes ("Subscription Enabled" and
 * "Subscription Discount") and applies a percentage discount
 * automatically at checkout — no discount code required.
 */

// Re-use the same AdminClient interface
interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface AutomaticDiscountCreateResponse {
  discountAutomaticAppCreate: {
    automaticAppDiscount: { discountId: string } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

interface AutomaticDiscountDeleteResponse {
  discountAutomaticDelete: {
    deletedAutomaticDiscountId: string | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

interface AutomaticDiscountListResponse {
  discountNodes: {
    nodes: Array<{
      id: string;
      discount: {
        __typename: string;
        title: string;
        status: string;
      };
    }>;
  };
}

const DISCOUNT_TITLE = "Subscription Discount";
const FUNCTION_HANDLE = "subscription-discount";

/**
 * Ensures the automatic discount exists for our subscription function.
 * Idempotent: if it already exists, returns the existing ID.
 */
export async function ensureAutomaticDiscount(
  admin: AdminClient,
): Promise<{ discountId: string; created: boolean }> {
  // First check if it already exists
  const existing = await findExistingDiscount(admin);
  if (existing) {
    console.log(
      `[automatic-discount] Found existing discount: ${existing}`,
    );
    return { discountId: existing, created: false };
  }

  // Create the automatic discount
  const response = await admin.graphql(
    `#graphql
    mutation CreateAutomaticDiscount($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        discount: {
          title: DISCOUNT_TITLE,
          functionId: FUNCTION_HANDLE,
          startsAt: new Date().toISOString(),
        },
      },
    },
  );

  const json =
    (await response.json()) as { data: AutomaticDiscountCreateResponse };
  const result = json.data.discountAutomaticAppCreate;

  if (result.userErrors.length > 0) {
    const errs = result.userErrors
      .map((e) => `${e.field.join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Failed to create automatic discount: ${errs}`);
  }

  const discountId = result.automaticAppDiscount!.discountId;
  console.log(
    `[automatic-discount] Created automatic discount: ${discountId}`,
  );
  return { discountId, created: true };
}

/**
 * Finds an existing automatic discount linked to our function.
 */
async function findExistingDiscount(
  admin: AdminClient,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
    query FindAutomaticDiscount {
      discountNodes(first: 50, query: "type:automatic AND status:active") {
        nodes {
          id
          discount {
            __typename
            ... on DiscountAutomaticApp {
              title
              status
            }
          }
        }
      }
    }`,
  );

  const json =
    (await response.json()) as { data: AutomaticDiscountListResponse };
  const nodes = json.data.discountNodes.nodes;

  const match = nodes.find(
    (n) =>
      n.discount.__typename === "DiscountAutomaticApp" &&
      n.discount.title === DISCOUNT_TITLE,
  );

  return match?.id ?? null;
}

/**
 * Removes the automatic discount (for cleanup/rollback).
 */
export async function removeAutomaticDiscount(
  admin: AdminClient,
  discountId: string,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
    mutation DeleteAutomaticDiscount($id: ID!) {
      discountAutomaticDelete(id: $id) {
        deletedAutomaticDiscountId
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: { id: discountId },
    },
  );

  const json =
    (await response.json()) as { data: AutomaticDiscountDeleteResponse };
  const result = json.data.discountAutomaticDelete;

  if (result.userErrors.length > 0) {
    const errs = result.userErrors
      .map((e) => `${e.field.join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Failed to delete automatic discount: ${errs}`);
  }

  console.log(
    `[automatic-discount] Deleted discount: ${result.deletedAutomaticDiscountId}`,
  );
}
