import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
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
import prisma from "../db.server";

interface SellingPlanInfo {
  id: string;
  name: string;
  options: string;
  category: string;
  billingPolicy: string;
  deliveryPolicy: string;
}

interface SellingPlanGroupInfo {
  id: string;
  name: string;
  merchantCode: string;
  appId: string | null;
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
            appId
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
                category
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
        appId: group.appId || null,
        productCount: group.productCount || 0,
        products: group.products?.nodes?.map((p: any) => ({
          id: p.id,
          title: p.title,
        })) || [],
        sellingPlans: group.sellingPlans?.nodes?.map((plan: any) => ({
          id: plan.id,
          name: plan.name,
          options: JSON.stringify(plan.options),
          category: plan.category || "UNKNOWN",
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

  // Query recent subscription contracts from Shopify
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

  // Query what's actually in SSMA's database
  const ssmaSubscriptions = await prisma.subscriptionPickup.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const ssmaPickupSchedules = await prisma.pickupSchedule.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return json({
    shop,
    sellingPlanGroups,
    testProductInfo,
    recentContracts,
    ssmaSubscriptions: ssmaSubscriptions.map(s => ({
      id: s.id,
      shopifyContractId: s.shopifyContractId,
      customerName: s.customerName,
      status: s.status,
      frequency: s.frequency,
      nextPickupDate: s.nextPickupDate?.toISOString() || null,
    })),
    ssmaPickupSchedules: ssmaPickupSchedules.map(p => ({
      id: p.id,
      shopifyOrderNumber: p.shopifyOrderNumber,
      customerName: p.customerName,
      pickupDate: p.pickupDate.toISOString(),
      pickupStatus: p.pickupStatus,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Remove product from a selling plan group
  if (intent === "remove_product_from_group") {
    const groupId = formData.get("groupId") as string;
    const productId = formData.get("productId") as string;

    try {
      const response = await admin.graphql(`
        mutation removeProductFromGroup($groupId: ID!, $productIds: [ID!]!) {
          sellingPlanGroupRemoveProducts(id: $groupId, productIds: $productIds) {
            removedProductIds
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
      console.log("Remove product response:", JSON.stringify(data, null, 2));

      if (data.data?.sellingPlanGroupRemoveProducts?.userErrors?.length > 0) {
        return json({
          error: data.data.sellingPlanGroupRemoveProducts.userErrors.map((e: any) => e.message).join(", "),
        });
      }

      return json({ success: true, message: "Product removed from selling plan group" });
    } catch (error) {
      console.error("Error removing product:", error);
      return json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

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

  // Sync subscription contracts from Shopify to SSMA
  if (intent === "sync_contracts") {
    try {
      const { createSubscriptionFromContract } = await import("../services/subscription.server");
      const { createPickupEvent } = await import("../services/google-calendar.server");
      const { session } = await authenticate.admin(request);
      const shop = session.shop;

      // Get all ACTIVE subscription contracts from Shopify
      const contractsResponse = await admin.graphql(`
        query getActiveContracts {
          subscriptionContracts(first: 50, query: "status:ACTIVE") {
            nodes {
              id
              status
              customer {
                id
                firstName
                lastName
                email
                phone
              }
              billingPolicy {
                interval
                intervalCount
              }
              deliveryPolicy {
                interval
                intervalCount
              }
              nextBillingDate
            }
          }
        }
      `);

      const contractsData = await contractsResponse.json();
      const contracts = contractsData.data?.subscriptionContracts?.nodes || [];

      let synced = 0;
      let skipped = 0;
      let pickupsCreated = 0;
      const errors: string[] = [];

      for (const contract of contracts) {
        // Check if already exists in SSMA
        const existing = await prisma.subscriptionPickup.findFirst({
          where: {
            shop,
            shopifyContractId: contract.id,
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        try {
          // Determine frequency from billing policy
          let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY" = "WEEKLY";
          const intervalCount = contract.billingPolicy?.intervalCount || 1;
          if (intervalCount === 2) frequency = "BIWEEKLY";
          else if (intervalCount === 3) frequency = "TRIWEEKLY";

          const customerName = `${contract.customer?.firstName || ""} ${contract.customer?.lastName || ""}`.trim() || "Unknown";
          const customerEmail = contract.customer?.email || null;
          const customerPhone = contract.customer?.phone || null;
          const preferredTimeSlot = "12:00 PM - 2:00 PM"; // Default time slot

          // Create subscription in SSMA
          const subscriptionId = await createSubscriptionFromContract(
            shop,
            contract.id,
            customerName,
            customerEmail,
            customerPhone,
            frequency,
            2, // Default to Tuesday
            preferredTimeSlot
          );
          synced++;

          // Now also create the first pickup schedule for this subscription
          // Get the subscription to get the nextPickupDate
          const subscription = await prisma.subscriptionPickup.findUnique({
            where: { id: subscriptionId },
          });

          if (subscription && subscription.nextPickupDate) {
            // Create pickup schedule entry
            const pickupSchedule = await prisma.pickupSchedule.create({
              data: {
                shop,
                shopifyOrderId: `subscription-${subscriptionId}-initial`,
                shopifyOrderNumber: `SUB-${subscriptionId.slice(-6).toUpperCase()}`,
                customerName,
                customerEmail,
                customerPhone,
                pickupDate: subscription.nextPickupDate,
                pickupTimeSlot: preferredTimeSlot,
                pickupStatus: "SCHEDULED",
                subscriptionPickupId: subscriptionId,
              },
            });
            pickupsCreated++;

            // Try to create Google Calendar event
            try {
              await createPickupEvent(shop, pickupSchedule.id);
            } catch (calError) {
              console.error("Failed to create calendar event:", calError);
            }
          }
        } catch (err) {
          errors.push(`Contract ${contract.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      return json({
        success: true,
        message: `Synced ${synced} contracts (${pickupsCreated} pickup schedules created), skipped ${skipped} (already exist)`,
        synced,
        skipped,
        pickupsCreated,
        errors,
      });
    } catch (error) {
      console.error("Error syncing contracts:", error);
      return json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  // Generate pickup schedules for existing subscriptions that don't have one yet
  if (intent === "generate_pickups") {
    try {
      const { createPickupEvent } = await import("../services/google-calendar.server");
      const { session } = await authenticate.admin(request);
      const shop = session.shop;

      // Find all active subscriptions that have a nextPickupDate but no corresponding pickup schedule
      const subscriptions = await prisma.subscriptionPickup.findMany({
        where: {
          shop,
          status: "ACTIVE",
          nextPickupDate: {
            not: null,
          },
        },
      });

      let pickupsCreated = 0;
      let alreadyHavePickup = 0;
      const errors: string[] = [];

      for (const subscription of subscriptions) {
        // Check if there's already a pickup schedule for this subscription's next pickup date
        const existingPickup = await prisma.pickupSchedule.findFirst({
          where: {
            shop,
            subscriptionPickupId: subscription.id,
            pickupDate: subscription.nextPickupDate!,
          },
        });

        if (existingPickup) {
          alreadyHavePickup++;
          continue;
        }

        try {
          // Create pickup schedule entry
          const pickupSchedule = await prisma.pickupSchedule.create({
            data: {
              shop,
              shopifyOrderId: `subscription-${subscription.id}-${Date.now()}`,
              shopifyOrderNumber: `SUB-${subscription.id.slice(-6).toUpperCase()}`,
              customerName: subscription.customerName,
              customerEmail: subscription.customerEmail,
              customerPhone: subscription.customerPhone,
              pickupDate: subscription.nextPickupDate!,
              pickupTimeSlot: subscription.preferredTimeSlot,
              pickupStatus: "SCHEDULED",
              subscriptionPickupId: subscription.id,
            },
          });
          pickupsCreated++;

          // Try to create Google Calendar event
          try {
            await createPickupEvent(shop, pickupSchedule.id);
          } catch (calError) {
            console.error("Failed to create calendar event:", calError);
          }
        } catch (err) {
          errors.push(`Subscription ${subscription.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      return json({
        success: true,
        message: `Created ${pickupsCreated} pickup schedules, ${alreadyHavePickup} already had pickups`,
        pickupsCreated,
        alreadyHavePickup,
        errors,
      });
    } catch (error) {
      console.error("Error generating pickups:", error);
      return json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  // Sync status from Shopify - update SSMA subscriptions with current Shopify contract status
  if (intent === "sync_status") {
    try {
      const { session } = await authenticate.admin(request);
      const shop = session.shop;

      // Get all subscriptions in SSMA
      const ssmaSubscriptions = await prisma.subscriptionPickup.findMany({
        where: { shop },
      });

      if (ssmaSubscriptions.length === 0) {
        return json({ success: true, message: "No subscriptions to sync" });
      }

      // Query Shopify for ALL contracts (not just active) to get current status
      const contractsResponse = await admin.graphql(`
        query getAllContracts {
          subscriptionContracts(first: 100) {
            nodes {
              id
              status
            }
          }
        }
      `);

      const contractsData = await contractsResponse.json();
      console.log("All contracts from Shopify:", JSON.stringify(contractsData, null, 2));
      const contracts = contractsData.data?.subscriptionContracts?.nodes || [];

      // Create a map of contract ID -> status
      const statusMap = new Map<string, string>();
      for (const contract of contracts) {
        statusMap.set(contract.id, contract.status);
        console.log(`Contract ${contract.id} has status: ${contract.status}`);
      }

      let updated = 0;
      let cancelled = 0;
      let notFound = 0;
      const errors: string[] = [];

      for (const subscription of ssmaSubscriptions) {
        const shopifyStatus = statusMap.get(subscription.shopifyContractId);
        console.log(`SSMA subscription ${subscription.id} (contract: ${subscription.shopifyContractId}) - SSMA status: ${subscription.status}, Shopify status: ${shopifyStatus || "NOT FOUND"}`);

        if (!shopifyStatus) {
          // Contract not found in Shopify - might have been deleted, mark as cancelled
          notFound++;
          try {
            await prisma.subscriptionPickup.update({
              where: { id: subscription.id },
              data: { status: "CANCELLED" },
            });
            cancelled++;
            updated++;
          } catch (err) {
            errors.push(`Subscription ${subscription.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
          }
          continue;
        }

        // Map Shopify status to SSMA status and always update if different
        let newStatus: "ACTIVE" | "PAUSED" | "CANCELLED" = "ACTIVE";
        if (shopifyStatus === "CANCELLED") {
          newStatus = "CANCELLED";
        } else if (shopifyStatus === "PAUSED") {
          newStatus = "PAUSED";
        }

        // Only update if status is different
        if (newStatus !== subscription.status) {
          try {
            await prisma.subscriptionPickup.update({
              where: { id: subscription.id },
              data: { status: newStatus },
            });
            if (newStatus === "CANCELLED") {
              cancelled++;
            }
            updated++;
            console.log(`Updated subscription ${subscription.id} from ${subscription.status} to ${newStatus}`);
          } catch (err) {
            errors.push(`Subscription ${subscription.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
          }
        }
      }

      return json({
        success: true,
        message: `Synced status for ${updated} subscriptions (${cancelled} marked as cancelled, ${notFound} contracts not found in Shopify)`,
        updated,
        cancelled,
        notFound,
        errors,
      });
    } catch (error) {
      console.error("Error syncing status:", error);
      return json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  // Generate multiple future pickup schedules for active subscriptions
  if (intent === "generate_future_pickups") {
    try {
      const { createPickupEvent } = await import("../services/google-calendar.server");
      const { session } = await authenticate.admin(request);
      const shop = session.shop;

      // Get weeks parameter (default to 4 weeks ahead)
      const weeksAhead = parseInt(formData.get("weeks") as string) || 4;

      // Find all active subscriptions
      const subscriptions = await prisma.subscriptionPickup.findMany({
        where: {
          shop,
          status: "ACTIVE",
        },
      });

      let pickupsCreated = 0;
      let alreadyExist = 0;
      const errors: string[] = [];

      for (const subscription of subscriptions) {
        if (!subscription.nextPickupDate) continue;

        // Generate pickup dates for the next X weeks
        const frequency = subscription.frequency === "BIWEEKLY" ? 14 : subscription.frequency === "TRIWEEKLY" ? 21 : 7;
        let currentDate = new Date(subscription.nextPickupDate);

        for (let week = 0; week < weeksAhead; week++) {
          const pickupDate = new Date(currentDate);
          pickupDate.setDate(pickupDate.getDate() + (week * frequency));

          // Check if pickup already exists for this date
          const existingPickup = await prisma.pickupSchedule.findFirst({
            where: {
              shop,
              subscriptionPickupId: subscription.id,
              pickupDate: {
                gte: new Date(pickupDate.setHours(0, 0, 0, 0)),
                lt: new Date(pickupDate.setHours(23, 59, 59, 999)),
              },
            },
          });

          if (existingPickup) {
            alreadyExist++;
            continue;
          }

          try {
            // Reset the date (it was modified by setHours)
            const cleanDate = new Date(subscription.nextPickupDate!);
            cleanDate.setDate(cleanDate.getDate() + (week * frequency));

            const pickupSchedule = await prisma.pickupSchedule.create({
              data: {
                shop,
                shopifyOrderId: `subscription-${subscription.id}-${cleanDate.getTime()}`,
                shopifyOrderNumber: `SUB-${subscription.id.slice(-6).toUpperCase()}`,
                customerName: subscription.customerName,
                customerEmail: subscription.customerEmail,
                customerPhone: subscription.customerPhone,
                pickupDate: cleanDate,
                pickupTimeSlot: subscription.preferredTimeSlot,
                pickupStatus: "SCHEDULED",
                subscriptionPickupId: subscription.id,
              },
            });
            pickupsCreated++;

            // Try to create Google Calendar event
            try {
              await createPickupEvent(shop, pickupSchedule.id);
            } catch (calError) {
              console.error("Failed to create calendar event:", calError);
            }
          } catch (err) {
            errors.push(`Week ${week} for ${subscription.customerName}: ${err instanceof Error ? err.message : "Unknown error"}`);
          }
        }
      }

      return json({
        success: true,
        message: `Created ${pickupsCreated} future pickup schedules (${alreadyExist} already existed)`,
        pickupsCreated,
        alreadyExist,
        errors,
      });
    } catch (error) {
      console.error("Error generating future pickups:", error);
      return json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  // Clear all test data (subscriptions, pickup schedules, webhook events)
  if (intent === "clear_test_data") {
    try {
      const { session } = await authenticate.admin(request);
      const shop = session.shop;

      // Delete in correct order due to foreign key constraints
      // 1. First delete pickup schedules (they reference subscriptions)
      const deletedPickups = await prisma.pickupSchedule.deleteMany({
        where: { shop },
      });

      // 2. Then delete subscriptions
      const deletedSubscriptions = await prisma.subscriptionPickup.deleteMany({
        where: { shop },
      });

      // 3. Delete webhook events
      const deletedEvents = await prisma.webhookEvent.deleteMany({
        where: { shop },
      });

      return json({
        success: true,
        message: `Cleared test data: ${deletedSubscriptions.count} subscriptions, ${deletedPickups.count} pickup schedules, ${deletedEvents.count} webhook events`,
        deletedSubscriptions: deletedSubscriptions.count,
        deletedPickups: deletedPickups.count,
        deletedEvents: deletedEvents.count,
      });
    } catch (error) {
      console.error("Error clearing test data:", error);
      return json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  // Reset selling plan config - deletes local config so SSMA can create a fresh group
  if (intent === "reset_selling_plan_config") {
    try {
      const { session } = await authenticate.admin(request);
      const shop = session.shop;

      // Delete the local selling plan config
      const deleted = await prisma.sellingPlanConfig.deleteMany({
        where: { shop },
      });

      // Also delete any additional selling plans stored locally
      await prisma.sellingPlan.deleteMany({
        where: {
          config: {
            shop,
          },
        },
      });

      return json({
        success: true,
        message: deleted.count > 0
          ? "Reset selling plan config. Go to Settings → Subscriptions to create a new selling plan group."
          : "No selling plan config found to reset.",
      });
    } catch (error) {
      console.error("Error resetting selling plan config:", error);
      return json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return json({ error: "Unknown action" });
};

export default function SubscriptionDebugPage() {
  const { shop, sellingPlanGroups, testProductInfo, recentContracts, ssmaSubscriptions, ssmaPickupSchedules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
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

  const handleRemoveProductFromGroup = (groupId: string, productId: string) => {
    if (!confirm("Remove this product from the selling plan group?")) return;
    const formData = new FormData();
    formData.append("intent", "remove_product_from_group");
    formData.append("groupId", groupId);
    formData.append("productId", productId);
    submit(formData, { method: "post" });
  };

  // Find SSMA's group (should be named "Subscribe & Save" or similar)
  const ssmaGroup = sellingPlanGroups.find(g =>
    g.name.toLowerCase().includes("subscribe") ||
    g.merchantCode === "subscribe-save"
  );

  return (
    <Page
      backAction={{ content: "Settings", url: "/app/settings" }}
      title="Subscription Debug"
    >
      <TitleBar title="Subscription Debug" />

      <Layout>
        {/* Action Result Banner */}
        {actionData && "message" in actionData && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => {}}>
              <p>{actionData.message}</p>
              {"synced" in actionData && (
                <p>Synced: {actionData.synced}, Skipped: {actionData.skipped}</p>
              )}
            </Banner>
          </Layout.Section>
        )}
        {actionData && "error" in actionData && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => {}}>
              <p>Error: {actionData.error}</p>
            </Banner>
          </Layout.Section>
        )}
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
                    <BlockStack gap="300">
                      <Text as="p">
                        Connected to {testProductInfo.sellingPlanGroups.length} selling plan group(s):
                      </Text>
                      {testProductInfo.sellingPlanGroups.map((group) => {
                        const isSSMAGroup = ssmaGroup && group.id === ssmaGroup.id;
                        return (
                          <Box
                            key={group.id}
                            padding="300"
                            background={isSSMAGroup ? "bg-surface-success" : "bg-surface-warning"}
                            borderRadius="100"
                          >
                            <InlineStack align="space-between" blockAlign="center">
                              <BlockStack gap="100">
                                <InlineStack gap="200">
                                  <Text as="span" fontWeight="semibold">{group.name}</Text>
                                  <Badge tone={isSSMAGroup ? "success" : "warning"}>
                                    {isSSMAGroup ? "SSMA Group" : "Other Group"}
                                  </Badge>
                                </InlineStack>
                                <Text as="p" tone="subdued">{group.planCount} plans</Text>
                              </BlockStack>
                              {!isSSMAGroup && (
                                <Button
                                  variant="primary"
                                  tone="critical"
                                  onClick={() => handleRemoveProductFromGroup(group.id, testProductInfo.productId)}
                                  loading={isLoading}
                                >
                                  Remove from this group
                                </Button>
                              )}
                            </InlineStack>
                          </Box>
                        );
                      })}

                      {/* Show warning if connected to wrong group */}
                      {!testProductInfo.sellingPlanGroups.some(g => ssmaGroup && g.id === ssmaGroup.id) && ssmaGroup && (
                        <Banner tone="warning">
                          <BlockStack gap="200">
                            <Text as="p">
                              <strong>Issue:</strong> This product is connected to a selling plan group that is NOT SSMA's group.
                              This is why subscriptions aren't being created in SSMA.
                            </Text>
                            <Text as="p">
                              <strong>Fix:</strong> Click "Remove from this group" above, then add the product to SSMA's "{ssmaGroup.name}" group below.
                            </Text>
                          </BlockStack>
                        </Banner>
                      )}
                    </BlockStack>
                  ) : (
                    <Banner tone="critical">
                      <p>
                        <strong>Problem Found:</strong> This product is NOT connected to any selling plan group!
                        This is why subscriptions aren't being created. Add it to SSMA's selling plan group below.
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

                        {/* Show App ID - critical for subscription contract creation */}
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">Owner App:</Text>
                          {group.appId ? (
                            <Badge tone="success">{group.appId}</Badge>
                          ) : (
                            <Badge tone="critical">No app owner (contracts won't be created!)</Badge>
                          )}
                        </InlineStack>

                        <Divider />

                        <Text as="p" fontWeight="semibold">Selling Plans:</Text>
                        {group.sellingPlans.length > 0 ? (
                          <List type="bullet">
                            {group.sellingPlans.map((plan) => (
                              <List.Item key={plan.id}>
                                <InlineStack gap="100">
                                  <Text as="span">{plan.name}</Text>
                                  <Badge tone={plan.category === "SUBSCRIPTION" ? "success" : "warning"}>
                                    {plan.category}
                                  </Badge>
                                  <Text as="span" tone="subdued">
                                    Billing: {plan.billingPolicy}, Delivery: {plan.deliveryPolicy}
                                  </Text>
                                </InlineStack>
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
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Recent Subscription Contracts in Shopify</Text>
                <InlineStack gap="200">
                  <Button
                    variant="primary"
                    onClick={() => {
                      const formData = new FormData();
                      formData.append("intent", "sync_contracts");
                      submit(formData, { method: "post" });
                    }}
                    loading={isLoading}
                  >
                    Sync Contracts to SSMA
                  </Button>
                  <Button
                    onClick={() => {
                      const formData = new FormData();
                      formData.append("intent", "sync_status");
                      submit(formData, { method: "post" });
                    }}
                    loading={isLoading}
                  >
                    Sync Status from Shopify
                  </Button>
                  <Button
                    onClick={() => {
                      const formData = new FormData();
                      formData.append("intent", "generate_future_pickups");
                      formData.append("weeks", "4");
                      submit(formData, { method: "post" });
                    }}
                    loading={isLoading}
                  >
                    Generate 4 Weeks of Pickups
                  </Button>
                  <Button
                    onClick={() => {
                      const formData = new FormData();
                      formData.append("intent", "generate_pickups");
                      submit(formData, { method: "post" });
                    }}
                    loading={isLoading}
                  >
                    Generate Pickup Schedules
                  </Button>
                </InlineStack>
              </InlineStack>

              <Banner tone="info">
                <p>
                  <strong>Contracts exist but not in SSMA?</strong> Click "Sync Contracts to SSMA" to import
                  all active Shopify subscription contracts into SSMA's subscription management.
                  Then click "Generate Pickup Schedules" to create calendar entries for each subscription.
                </p>
              </Banner>

              {recentContracts.length === 0 ? (
                <Banner tone="warning">
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

        {/* SSMA Database Contents */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">SSMA Database Contents</Text>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Subscriptions in SSMA ({ssmaSubscriptions.length})</Text>
                {ssmaSubscriptions.length === 0 ? (
                  <Banner tone="warning">
                    <p>No subscriptions in SSMA database. Click "Sync Contracts to SSMA" above to import them.</p>
                  </Banner>
                ) : (
                  <List type="bullet">
                    {ssmaSubscriptions.map((sub: any) => (
                      <List.Item key={sub.id}>
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">{sub.customerName}</Text>
                          <Badge tone={sub.status === "ACTIVE" ? "success" : "warning"}>{sub.status}</Badge>
                          <Text as="span" tone="subdued">{sub.frequency}</Text>
                          <Text as="span" tone="subdued">
                            Next: {sub.nextPickupDate ? new Date(sub.nextPickupDate).toLocaleDateString() : "N/A"}
                          </Text>
                        </InlineStack>
                      </List.Item>
                    ))}
                  </List>
                )}
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Pickup Schedules in SSMA ({ssmaPickupSchedules.length})</Text>
                {ssmaPickupSchedules.length === 0 ? (
                  <Banner tone="warning">
                    <p>No pickup schedules in SSMA database. These are created when subscriptions are synced or orders come in.</p>
                  </Banner>
                ) : (
                  <List type="bullet">
                    {ssmaPickupSchedules.map((pickup: any) => (
                      <List.Item key={pickup.id}>
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">{pickup.customerName}</Text>
                          <Badge>{pickup.shopifyOrderNumber}</Badge>
                          <Text as="span" tone="subdued">
                            {new Date(pickup.pickupDate).toLocaleDateString()}
                          </Text>
                          <Badge tone={pickup.pickupStatus === "SCHEDULED" ? "info" : "success"}>
                            {pickup.pickupStatus}
                          </Badge>
                        </InlineStack>
                      </List.Item>
                    ))}
                  </List>
                )}
              </BlockStack>
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

        {/* Clear Test Data */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Clear Test Data</Text>
              <Banner tone="warning">
                <p>
                  <strong>Warning:</strong> This will delete ALL subscriptions, pickup schedules, and webhook events
                  from SSMA's database. Use this to clean up test data before migrating real customers.
                </p>
              </Banner>
              <InlineStack gap="200">
                <Button
                  tone="critical"
                  onClick={() => {
                    if (!confirm("Are you sure you want to delete ALL SSMA data? This cannot be undone!")) return;
                    const formData = new FormData();
                    formData.append("intent", "clear_test_data");
                    submit(formData, { method: "post" });
                  }}
                  loading={isLoading}
                >
                  Clear All Test Data
                </Button>
                <Button
                  onClick={() => {
                    if (!confirm("Reset selling plan config? You will need to recreate the selling plan group in Settings → Subscriptions.")) return;
                    const formData = new FormData();
                    formData.append("intent", "reset_selling_plan_config");
                    submit(formData, { method: "post" });
                  }}
                  loading={isLoading}
                >
                  Reset Selling Plan Config
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
