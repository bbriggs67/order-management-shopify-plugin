import {
  reactExtension,
  useApi,
  AdminAction,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Box,
  Divider,
  Badge,
  Checkbox,
} from "@shopify/ui-extensions-react/admin";
import { useState, useEffect } from "react";

// GraphQL query to get selling plan group details
const SELLING_PLAN_GROUP_QUERY = `
  query getSellingPlanGroup($id: ID!) {
    sellingPlanGroup(id: $id) {
      id
      name
      sellingPlans(first: 20) {
        edges {
          node {
            id
            name
            billingPolicy {
              ... on SellingPlanRecurringBillingPolicy {
                interval
                intervalCount
              }
            }
            pricingPolicies {
              ... on SellingPlanFixedPricingPolicy {
                adjustmentType
                adjustmentValue {
                  ... on SellingPlanPricingPolicyPercentageValue {
                    percentage
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// GraphQL mutation to delete a selling plan from a group
const DELETE_SELLING_PLAN_MUTATION = `
  mutation deleteSellingPlan($id: ID!, $sellingPlanIdsToDelete: [ID!]!) {
    sellingPlanGroupUpdate(id: $id, input: { sellingPlansToDelete: $sellingPlanIdsToDelete }) {
      deletedSellingPlanIds
      userErrors {
        field
        message
      }
    }
  }
`;

// GraphQL mutation to remove product from selling plan group
const REMOVE_PRODUCT_FROM_GROUP_MUTATION = `
  mutation removeProductFromSellingPlanGroup($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
      removedProductIds
      userErrors {
        field
        message
      }
    }
  }
`;

interface SellingPlan {
  id: string;
  name: string;
  interval: string;
  intervalCount: number;
  discount: number;
}

interface SellingPlanGroup {
  id: string;
  name: string;
  plans: SellingPlan[];
}

// Shopify Admin extension API types (not fully typed in @shopify/ui-extensions-react/admin)
interface GraphQLResult {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

interface ExtensionData {
  selected?: Array<{
    sellingPlanId?: string;
    id?: string;
  }>;
}

function formatInterval(interval: string, count: number): string {
  const intervalLabel = interval.toLowerCase();
  if (count === 1) {
    return `Every ${intervalLabel.replace("s", "")}`;
  }
  return `Every ${count} ${intervalLabel.toLowerCase()}`;
}

// Extension for product page
const ProductPurchaseOptionExtension = reactExtension(
  "admin.product-purchase-option.action.render",
  () => <PurchaseOptionsAction />
);

// Extension for variant page
const VariantPurchaseOptionExtension = reactExtension(
  "admin.product-variant-purchase-option.action.render",
  () => <PurchaseOptionsAction />
);

function PurchaseOptionsAction() {
  const api = useApi<"admin.product-purchase-option.action.render">();
  const { close, query } = api;

  // Get data from the API - structure may vary, handle gracefully
  const data = ("data" in api ? api.data : {}) as ExtensionData;
  const selected = data?.selected || [];
  const firstSelected = selected[0] || {};

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sellingPlanGroup, setSellingPlanGroup] = useState<SellingPlanGroup | null>(null);
  const [selectedPlans, setSelectedPlans] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Get the selling plan group ID from the data
  const sellingPlanGroupId = firstSelected?.sellingPlanId || null;
  const productId = firstSelected?.id || null;

  useEffect(() => {
    if (sellingPlanGroupId) {
      loadSellingPlanGroup();
    } else {
      setLoading(false);
    }
  }, [sellingPlanGroupId]);

  async function loadSellingPlanGroup() {
    try {
      setLoading(true);
      setError(null);

      const result = await query(SELLING_PLAN_GROUP_QUERY, {
        variables: { id: sellingPlanGroupId },
      });

      if ((result as GraphQLResult).errors) {
        throw new Error((result as GraphQLResult).errors.map((e: { message: string }) => e.message).join(", "));
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const group = (result as GraphQLResult).data?.sellingPlanGroup as any;
      if (!group) {
        throw new Error("Selling plan group not found");
      }

      const plans: SellingPlan[] = group.sellingPlans.edges.map((edge: { node: Record<string, unknown> }) => {
        const plan = edge.node as Record<string, any>;
        const pricingPolicy = plan.pricingPolicies?.[0];
        const discount = pricingPolicy?.adjustmentValue?.percentage || 0;

        return {
          id: plan.id,
          name: plan.name,
          interval: plan.billingPolicy?.interval || "WEEK",
          intervalCount: plan.billingPolicy?.intervalCount || 1,
          discount,
        };
      });

      setSellingPlanGroup({
        id: group.id,
        name: group.name,
        plans,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load selling plan group");
    } finally {
      setLoading(false);
    }
  }

  function togglePlanSelection(planId: string) {
    setSelectedPlans((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(planId)) {
        newSet.delete(planId);
      } else {
        newSet.add(planId);
      }
      return newSet;
    });
  }

  async function handleDeleteSelectedPlans() {
    if (selectedPlans.size === 0 || !sellingPlanGroup) return;

    try {
      setIsDeleting(true);
      setError(null);

      const result = await query(DELETE_SELLING_PLAN_MUTATION, {
        variables: {
          id: sellingPlanGroup.id,
          sellingPlanIdsToDelete: Array.from(selectedPlans),
        },
      });

      if ((result as GraphQLResult).errors) {
        throw new Error((result as GraphQLResult).errors.map((e: { message: string }) => e.message).join(", "));
      }

      const userErrors = (result as GraphQLResult).data?.sellingPlanGroupUpdate?.userErrors;
      if (userErrors && userErrors.length > 0) {
        throw new Error(userErrors.map((e: { message: string }) => e.message).join(", "));
      }

      // Reload the selling plan group to reflect changes
      await loadSellingPlanGroup();
      setSelectedPlans(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete plans");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleRemoveFromProduct() {
    if (!sellingPlanGroup || !productId) return;

    try {
      setIsRemoving(true);
      setError(null);

      const result = await query(REMOVE_PRODUCT_FROM_GROUP_MUTATION, {
        variables: {
          id: sellingPlanGroup.id,
          productIds: [productId],
        },
      });

      if ((result as GraphQLResult).errors) {
        throw new Error((result as GraphQLResult).errors.map((e: { message: string }) => e.message).join(", "));
      }

      const userErrors = (result as GraphQLResult).data?.sellingPlanGroupRemoveProducts?.userErrors;
      if (userErrors && userErrors.length > 0) {
        throw new Error(userErrors.map((e: { message: string }) => e.message).join(", "));
      }

      // Close the action panel after removing
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove from product");
    } finally {
      setIsRemoving(false);
    }
  }

  if (loading) {
    return (
      <AdminAction title="Subscription Options">
        <BlockStack>
          <Text>Loading subscription options...</Text>
        </BlockStack>
      </AdminAction>
    );
  }

  if (!sellingPlanGroupId) {
    return (
      <AdminAction title="Add Subscription Options">
        <BlockStack>
          <Text>
            To add subscription options to this product, go to the Susies Sourdough Manager app
            and add products to a selling plan group.
          </Text>
          <Button
            onPress={() => {
              // Can't directly navigate in admin extensions, so just close
              close();
            }}
          >
            Close
          </Button>
        </BlockStack>
      </AdminAction>
    );
  }

  if (error) {
    return (
      <AdminAction title="Subscription Options">
        <BlockStack>
          <Text>{error}</Text>
          <Button onPress={loadSellingPlanGroup}>Retry</Button>
        </BlockStack>
      </AdminAction>
    );
  }

  if (!sellingPlanGroup) {
    return (
      <AdminAction title="Subscription Options">
        <BlockStack>
          <Text>No subscription options found for this product.</Text>
        </BlockStack>
      </AdminAction>
    );
  }

  return (
    <AdminAction
      title={`Edit ${sellingPlanGroup.name}`}
      primaryAction={
        <Button
          disabled={selectedPlans.size === 0 || isDeleting}
          onPress={handleDeleteSelectedPlans}
        >
          {isDeleting ? "Deleting..." : `Delete Selected (${selectedPlans.size})`}
        </Button>
      }
      secondaryAction={
        <Button onPress={() => close()}>Cancel</Button>
      }
    >
      <BlockStack>
        <Text>
          <Text fontWeight="bold">{sellingPlanGroup.name}</Text> - {sellingPlanGroup.plans.length} plan(s)
        </Text>

        <Divider />

        {sellingPlanGroup.plans.length === 0 ? (
          <Text>No subscription plans in this group.</Text>
        ) : (
          <BlockStack>
            <Text fontWeight="bold">Select plans to delete:</Text>
            {sellingPlanGroup.plans.map((plan) => (
              <Box key={plan.id} padding="base">
                <InlineStack blockAlignment="center">
                  <Checkbox
                    checked={selectedPlans.has(plan.id)}
                    onChange={() => togglePlanSelection(plan.id)}
                  />
                  <BlockStack>
                    <InlineStack>
                      <Text>{plan.name}</Text>
                      {plan.discount > 0 && (
                        <Badge tone="success">{plan.discount}% off</Badge>
                      )}
                    </InlineStack>
                    <Text>
                      {formatInterval(plan.interval, plan.intervalCount)}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        )}

        <Divider />

        <BlockStack>
          <Text fontWeight="bold">Or remove subscription from this product:</Text>
          <Button
            disabled={isRemoving}
            onPress={handleRemoveFromProduct}
          >
            {isRemoving ? "Removing..." : "Remove Subscription from Product"}
          </Button>
          <Text>
            This removes the subscription option from this product only. The subscription plan
            will remain available for other products.
          </Text>
        </BlockStack>
      </BlockStack>
    </AdminAction>
  );
}

export { ProductPurchaseOptionExtension, VariantPurchaseOptionExtension };
export default ProductPurchaseOptionExtension;
