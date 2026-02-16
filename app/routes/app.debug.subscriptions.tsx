import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  Badge,
  Box,
  Divider,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

interface SellingPlanInfo {
  id: string;
  name: string;
  options: string;
  billingPolicy: string;
  deliveryPolicy: string;
}

interface SellingPlanGroupInfo {
  id: string;
  name: string;
  merchantCode: string;
  productCount: number;
  products: Array<{
    id: string;
    title: string;
  }>;
  sellingPlans: SellingPlanInfo[];
}

interface ProductSellingPlanInfo {
  productId: string;
  productTitle: string;
  sellingPlanGroups: Array<{
    id: string;
    name: string;
    planCount: number;
  }>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Query all selling plan groups with full details
  let sellingPlanGroups: SellingPlanGroupInfo[] = [];
  try {
    const groupsResponse = await admin.graphql(`
      query getSellingPlanGroups {
        sellingPlanGroups(first: 20) {
          nodes {
            id
            name
            merchantCode
            productCount
            products(first: 50) {
              nodes {
                id
                title
              }
            }
            sellingPlans(first: 20) {
              nodes {
                id
                name
                options
                billingPolicy {
                  ... on SellingPlanRecurringBillingPolicy {
                    interval
                    intervalCount
                  }
                }
                deliveryPolicy {
                  ... on SellingPlanRecurringDeliveryPolicy {
                    interval
                    intervalCount
                  }
                }
              }
            }
          }
        }
      }
    `);

    const groupsData = await groupsResponse.json();
    console.log("Selling plan groups response:", JSON.stringify(groupsData, null, 2));

    if (groupsData.data?.sellingPlanGroups?.nodes) {
      sellingPlanGroups = groupsData.data.sellingPlanGroups.nodes.map((group: any) => ({
        id: group.id,
        name: group.name,
        merchantCode: group.merchantCode || "N/A",
        productCount: group.productCount || 0,
        products: group.products?.nodes?.map((p: any) => ({
          id: p.id,
          title: p.title,
        })) || [],
        sellingPlans: group.sellingPlans?.nodes?.map((plan: any) => ({
          id: plan.id,
          name: plan.name,
          options: JSON.stringify(plan.options),
          billingPolicy: plan.billingPolicy?.interval
            ? `Every ${plan.billingPolicy.intervalCount} ${plan.billingPolicy.interval.toLowerCase()}(s)`
            : "N/A",
          deliveryPolicy: plan.deliveryPolicy?.interval
            ? `Every ${plan.deliveryPolicy.intervalCount} ${plan.deliveryPolicy.interval.toLowerCase()}(s)`
            : "N/A",
        })) || [],
      }));
    }
  } catch (error) {
    console.error("Error fetching selling plan groups:", error);
  }

  // Query TEST product specifically
  let testProductInfo: ProductSellingPlanInfo | null = null;
  try {
    const productsResponse = await admin.graphql(`
      query getTestProduct {
        products(first: 10, query: "TEST") {
          nodes {
            id
            title
            sellingPlanGroups(first: 10) {
              nodes {
                id
                name
                sellingPlans(first: 10) {
                  nodes {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `);

    const productsData = await productsResponse.json();
    console.log("Products response:", JSON.stringify(productsData, null, 2));

    if (productsData.data?.products?.nodes?.length > 0) {
      const testProduct = productsData.data.products.nodes.find((p: any) =>
        p.title.toUpperCase().includes("TEST")
      );
      if (testProduct) {
        testProductInfo = {
          productId: testProduct.id,
          productTitle: testProduct.title,
          sellingPlanGroups: testProduct.sellingPlanGroups?.nodes?.map((g: any) => ({
            id: g.id,
            name: g.name,
            planCount: g.sellingPlans?.nodes?.length || 0,
          })) || [],
        };
      }
    }
  } catch (error) {
    console.error("Error fetching test product:", error);
  }

  // Query recent subscription contracts
  let recentContracts: Array<{
    id: string;
    status: string;
    customerName: string;
    createdAt: string;
    nextBillingDate: string | null;
  }> = [];
  try {
    const contractsResponse = await admin.graphql(`
      query getRecentContracts {
        subscriptionContracts(first: 10, reverse: true) {
          nodes {
            id
            status
            customer {
              firstName
              lastName
            }
            createdAt
            nextBillingDate
          }
        }
      }
    `);

    const contractsData = await contractsResponse.json();
    console.log("Contracts response:", JSON.stringify(contractsData, null, 2));

    if (contractsData.data?.subscriptionContracts?.nodes) {
      recentContracts = contractsData.data.subscriptionContracts.nodes.map((c: any) => ({
        id: c.id,
        status: c.status,
        customerName: `${c.customer?.firstName || ""} ${c.customer?.lastName || ""}`.trim() || "Unknown",
        createdAt: c.createdAt,
        nextBillingDate: c.nextBillingDate,
      }));
    }
  } catch (error) {
    console.error("Error fetching subscription contracts:", error);
  }

  return json({
    shop,
    sellingPlanGroups,
    testProductInfo,
    recentContracts,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "add_test_product") {
    const groupId = formData.get("groupId") as string;
    const productId = formData.get("productId") as string;

    try {
      const response = await admin.graphql(`
        mutation addProductToGroup($groupId: ID!, $productIds: [ID!]!) {
          sellingPlanGroupAddProducts(id: $groupId, productIds: $productIds) {
            sellingPlanGroup {
              id
              name
              productCount
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          groupId,
          productIds: [productId],
        },
      });

      const data = await response.json();
      console.log("Add product response:", JSON.stringify(data, null, 2));

      if (data.data?.sellingPlanGroupAddProducts?.userErrors?.length > 0) {
        return json({
          error: data.data.sellingPlanGroupAddProducts.userErrors.map((e: any) => e.message).join(", "),
        });
      }

      return json({ success: true, message: "Product added to selling plan group" });
    } catch (error) {
      console.error("Error adding product:", error);
      return json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return json({ error: "Unknown action" });
};

export default function SubscriptionDebugPage() {
  const { shop, sellingPlanGroups, testProductInfo, recentContracts } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const handleAddProductToGroup = (groupId: string, productId: string) => {
    const formData = new FormData();
    formData.append("intent", "add_test_product");
    formData.append("groupId", groupId);
    formData.append("productId", productId);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Subscription Debug"
    >
      <TitleBar title="Subscription Debug" />

      <Layout>
        {/* TEST Product Status */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">TEST Product Status</Text>

              {testProductInfo ? (
                <BlockStack gap="300">
                  <InlineStack gap="200" align="space-between">
                    <Text as="span" fontWeight="semibold">{testProductInfo.productTitle}</Text>
                    <Badge tone="info">{testProductInfo.productId}</Badge>
                  </InlineStack>

                  {testProductInfo.sellingPlanGroups.length > 0 ? (
                    <BlockStack gap="200">
                      <Text as="p" tone="success">
                        Connected to {testProductInfo.sellingPlanGroups.length} selling plan group(s):
                      </Text>
                      <List type="bullet">
                        {testProductInfo.sellingPlanGroups.map((group) => (
                          <List.Item key={group.id}>
                            <Text as="span" fontWeight="semibold">{group.name}</Text>
                            {" "}({group.planCount} plans)
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  ) : (
                    <Banner tone="critical">
                      <p>
                        <strong>Problem Found:</strong> This product is NOT connected to any selling plan group!
                        This is why subscriptions aren't being created.
                      </p>
                    </Banner>
                  )}
                </BlockStack>
              ) : (
                <Banner tone="warning">
                  <p>Could not find TEST product. Make sure the product title contains "TEST".</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Selling Plan Groups */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">All Selling Plan Groups in Shopify</Text>

              {sellingPlanGroups.length === 0 ? (
                <Banner tone="critical">
                  <p>
                    <strong>No selling plan groups found!</strong> You need to create a selling plan group
                    in SSMA Settings → Subscriptions before subscription purchases will work.
                  </p>
                </Banner>
              ) : (
                <BlockStack gap="400">
                  {sellingPlanGroups.map((group) => (
                    <Box
                      key={group.id}
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingSm">{group.name}</Text>
                          <Badge>{group.productCount} products</Badge>
                        </InlineStack>

                        <Text as="p" tone="subdued">
                          ID: {group.id} | Code: {group.merchantCode}
                        </Text>

                        <Divider />

                        <Text as="p" fontWeight="semibold">Selling Plans:</Text>
                        {group.sellingPlans.length > 0 ? (
                          <List type="bullet">
                            {group.sellingPlans.map((plan) => (
                              <List.Item key={plan.id}>
                                {plan.name} - Billing: {plan.billingPolicy}, Delivery: {plan.deliveryPolicy}
                              </List.Item>
                            ))}
                          </List>
                        ) : (
                          <Text as="p" tone="caution">No selling plans in this group</Text>
                        )}

                        <Divider />

                        <Text as="p" fontWeight="semibold">Products in this group:</Text>
                        {group.products.length > 0 ? (
                          <List type="bullet">
                            {group.products.map((product) => (
                              <List.Item key={product.id}>{product.title}</List.Item>
                            ))}
                          </List>
                        ) : (
                          <Text as="p" tone="caution">No products assigned</Text>
                        )}

                        {/* Add TEST product button if not already in group */}
                        {testProductInfo && !group.products.some(p => p.id === testProductInfo.productId) && (
                          <Button
                            onClick={() => handleAddProductToGroup(group.id, testProductInfo.productId)}
                            loading={isLoading}
                          >
                            Add "{testProductInfo.productTitle}" to this group
                          </Button>
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent Subscription Contracts */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Recent Subscription Contracts in Shopify</Text>

              {recentContracts.length === 0 ? (
                <Banner tone="info">
                  <p>No subscription contracts found in Shopify. When customers purchase subscription products, contracts will appear here.</p>
                </Banner>
              ) : (
                <List type="bullet">
                  {recentContracts.map((contract) => (
                    <List.Item key={contract.id}>
                      <InlineStack gap="200">
                        <Text as="span" fontWeight="semibold">{contract.customerName}</Text>
                        <Badge tone={contract.status === "ACTIVE" ? "success" : "warning"}>
                          {contract.status}
                        </Badge>
                        <Text as="span" tone="subdued">
                          Created: {new Date(contract.createdAt).toLocaleDateString()}
                        </Text>
                      </InlineStack>
                    </List.Item>
                  ))}
                </List>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Instructions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Troubleshooting Steps</Text>
              <List type="number">
                <List.Item>
                  <strong>Check if TEST product is connected to a selling plan group</strong> - If it shows "NOT connected", that's the problem.
                </List.Item>
                <List.Item>
                  <strong>Use the "Add to group" button</strong> to connect the TEST product to SSMA's selling plan group.
                </List.Item>
                <List.Item>
                  <strong>Verify selling plans exist</strong> - The group should have plans for Weekly, Bi-Weekly, etc.
                </List.Item>
                <List.Item>
                  <strong>Place a new test order</strong> after adding the product to the group.
                </List.Item>
                <List.Item>
                  <strong>Check if subscription contract appears</strong> in the "Recent Contracts" section above.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
