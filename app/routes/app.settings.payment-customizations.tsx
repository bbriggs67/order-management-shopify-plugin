import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// GraphQL query to get existing payment customizations
const GET_PAYMENT_CUSTOMIZATIONS = `
  query GetPaymentCustomizations {
    paymentCustomizations(first: 25) {
      nodes {
        id
        title
        enabled
        functionId
      }
    }
  }
`;

// GraphQL mutation to create a payment customization
const CREATE_PAYMENT_CUSTOMIZATION = `
  mutation CreatePaymentCustomization($functionId: String!, $title: String!, $enabled: Boolean!) {
    paymentCustomizationCreate(
      paymentCustomization: {
        functionId: $functionId
        title: $title
        enabled: $enabled
      }
    ) {
      paymentCustomization {
        id
        title
        enabled
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// GraphQL mutation to update a payment customization
const UPDATE_PAYMENT_CUSTOMIZATION = `
  mutation UpdatePaymentCustomization($id: ID!, $enabled: Boolean!) {
    paymentCustomizationUpdate(
      id: $id
      paymentCustomization: {
        enabled: $enabled
      }
    ) {
      paymentCustomization {
        id
        title
        enabled
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// GraphQL mutation to delete a payment customization
const DELETE_PAYMENT_CUSTOMIZATION = `
  mutation DeletePaymentCustomization($id: ID!) {
    paymentCustomizationDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

// Query to get available functions
const GET_SHOPIFY_FUNCTIONS = `
  query GetShopifyFunctions {
    shopifyFunctions(first: 25) {
      nodes {
        id
        title
        apiType
        app {
          title
        }
      }
    }
  }
`;

const HIDE_COD_FUNCTION_HANDLE = "hide-cod-subscriptions";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Get existing payment customizations
  const customizationsResponse = await admin.graphql(GET_PAYMENT_CUSTOMIZATIONS);
  const customizationsData = await customizationsResponse.json();
  const paymentCustomizations = customizationsData.data?.paymentCustomizations?.nodes || [];

  // Get available Shopify Functions
  const functionsResponse = await admin.graphql(GET_SHOPIFY_FUNCTIONS);
  const functionsData = await functionsResponse.json();
  const shopifyFunctions = functionsData.data?.shopifyFunctions?.nodes || [];

  console.log("Available Shopify Functions:", JSON.stringify(shopifyFunctions, null, 2));

  // Find our payment customization function - look for payment customization API type
  const hideCodFunction = shopifyFunctions.find(
    (fn: { title: string; apiType: string }) =>
      fn.apiType === "payment_customization" &&
      (fn.title.toLowerCase().includes("hide cod") ||
       fn.title.toLowerCase().includes("hide-cod") ||
       fn.title.toLowerCase().includes("subscription"))
  );

  console.log("Found hideCodFunction:", hideCodFunction);

  // Check if our function is already activated
  const existingCustomization = paymentCustomizations.find(
    (pc: { functionId: string }) =>
      hideCodFunction && pc.functionId === hideCodFunction.id
  );

  return json({
    paymentCustomizations,
    shopifyFunctions,
    hideCodFunction,
    existingCustomization,
    isActivated: !!existingCustomization?.enabled,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "activate") {
    const functionId = formData.get("functionId") as string;

    console.log("Activate action - functionId:", functionId);

    if (!functionId) {
      return json({ error: "Function ID is required. The function may not be deployed yet." }, { status: 400 });
    }

    const response = await admin.graphql(CREATE_PAYMENT_CUSTOMIZATION, {
      variables: {
        functionId,
        title: "Hide COD for Subscriptions",
        enabled: true,
      },
    });

    const data = await response.json();

    console.log("Create payment customization response:", JSON.stringify(data, null, 2));

    if (data.data?.paymentCustomizationCreate?.userErrors?.length > 0) {
      return json({
        error: data.data.paymentCustomizationCreate.userErrors[0].message
      }, { status: 400 });
    }

    return json({ success: true, action: "activated" });
  }

  if (actionType === "toggle") {
    const customizationId = formData.get("customizationId") as string;
    const enabled = formData.get("enabled") === "true";

    const response = await admin.graphql(UPDATE_PAYMENT_CUSTOMIZATION, {
      variables: {
        id: customizationId,
        enabled,
      },
    });

    const data = await response.json();

    if (data.data?.paymentCustomizationUpdate?.userErrors?.length > 0) {
      return json({
        error: data.data.paymentCustomizationUpdate.userErrors[0].message
      }, { status: 400 });
    }

    return json({ success: true, action: enabled ? "enabled" : "disabled" });
  }

  if (actionType === "delete") {
    const customizationId = formData.get("customizationId") as string;

    const response = await admin.graphql(DELETE_PAYMENT_CUSTOMIZATION, {
      variables: {
        id: customizationId,
      },
    });

    const data = await response.json();

    if (data.data?.paymentCustomizationDelete?.userErrors?.length > 0) {
      return json({
        error: data.data.paymentCustomizationDelete.userErrors[0].message
      }, { status: 400 });
    }

    return json({ success: true, action: "deleted" });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function PaymentCustomizationsSettings() {
  const {
    hideCodFunction,
    existingCustomization,
    isActivated,
    shopifyFunctions
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const handleActivate = () => {
    if (!hideCodFunction) return;

    const formData = new FormData();
    formData.append("action", "activate");
    formData.append("functionId", hideCodFunction.id);
    submit(formData, { method: "post" });
  };

  const handleToggle = () => {
    if (!existingCustomization) return;

    const formData = new FormData();
    formData.append("action", "toggle");
    formData.append("customizationId", existingCustomization.id);
    formData.append("enabled", (!existingCustomization.enabled).toString());
    submit(formData, { method: "post" });
  };

  const handleDelete = () => {
    if (!existingCustomization) return;

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("customizationId", existingCustomization.id);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Payment Customizations"
    >
      <TitleBar title="Payment Customizations" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.error && (
              <Banner tone="critical" title="Error">
                <Text as="p">{actionData.error}</Text>
              </Banner>
            )}
            {actionData?.success && (
              <Banner tone="success" title="Success">
                <Text as="p">Payment customization {actionData.action} successfully!</Text>
              </Banner>
            )}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Hide COD for Subscriptions
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Automatically hides Cash on Delivery (COD) payment option when the cart contains subscription products.
                    </Text>
                  </BlockStack>
                  {existingCustomization ? (
                    <Badge tone={existingCustomization.enabled ? "success" : "warning"}>
                      {existingCustomization.enabled ? "Active" : "Inactive"}
                    </Badge>
                  ) : (
                    <Badge tone="info">Not Activated</Badge>
                  )}
                </InlineStack>

                <Divider />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    Why is this needed?
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Subscriptions require payment methods that can be charged automatically for recurring billing.
                    Cash on Delivery (COD) cannot be charged automatically, so if a customer selects COD for a
                    subscription order, Shopify will create a regular one-time order instead of a subscription contract.
                  </Text>
                  <Text as="p" variant="bodyMd">
                    When this function is active, customers with subscription items in their cart will only see
                    payment methods that support automatic charging (credit cards, Shop Pay, etc.).
                  </Text>
                </BlockStack>

                <Divider />

                {!hideCodFunction ? (
                  <Banner tone="critical">
                    <BlockStack gap="200">
                      <Text as="p">
                        The "Hide COD for Subscriptions" function was not found.
                        Please ensure the app has been deployed with the latest version.
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Run `npx shopify app deploy` to deploy the function extension.
                      </Text>
                    </BlockStack>
                  </Banner>
                ) : !existingCustomization ? (
                  <InlineStack gap="300">
                    <Button
                      variant="primary"
                      onClick={handleActivate}
                      loading={isLoading}
                    >
                      Activate Function
                    </Button>
                  </InlineStack>
                ) : (
                  <InlineStack gap="300">
                    <Button
                      variant={existingCustomization.enabled ? "secondary" : "primary"}
                      onClick={handleToggle}
                      loading={isLoading}
                    >
                      {existingCustomization.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={handleDelete}
                      loading={isLoading}
                    >
                      Remove
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  How to Test
                </Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    1. Add a subscription product to your cart (select a subscription option, not one-time purchase)
                  </Text>
                  <Text as="p" variant="bodyMd">
                    2. Proceed to checkout
                  </Text>
                  <Text as="p" variant="bodyMd">
                    3. Verify that Cash on Delivery is NOT shown as a payment option
                  </Text>
                  <Text as="p" variant="bodyMd">
                    4. Complete the order with a valid payment method (credit card, Shop Pay, etc.)
                  </Text>
                  <Text as="p" variant="bodyMd">
                    5. Check that the subscription appears in the customer portal and admin
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Debug info - can be removed later */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Debug Info
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Function found: {hideCodFunction ? "Yes" : "No"}
                </Text>
                {hideCodFunction && (
                  <>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Function ID: {hideCodFunction.id}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Function Title: {hideCodFunction.title}
                    </Text>
                  </>
                )}
                <Text as="p" variant="bodySm" tone="subdued">
                  Available functions ({shopifyFunctions?.length || 0}):
                </Text>
                {shopifyFunctions?.map((fn: { id: string; title: string; apiType: string }) => (
                  <Text key={fn.id} as="p" variant="bodySm" tone="subdued">
                    - {fn.title} ({fn.apiType}): {fn.id}
                  </Text>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
