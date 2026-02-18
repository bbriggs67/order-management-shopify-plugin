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
  DataTable,
  Box,
  Divider,
  TextField,
  FormLayout,
  Modal,
  Select,
  Thumbnail,
  Icon,
  Collapsible,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { ImageIcon, DeleteIcon, ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import {
  ensureSellingPlanGroup,
  getSellingPlanConfig,
  addProductsToSellingPlanGroup,
  removeProductsFromSellingPlanGroup,
  getAllSellingPlanGroups,
  addSellingPlanToGroup,
  deleteSellingPlan,
  syncSellingPlansFromSSMA,
} from "../services/selling-plans.server";
import type { SellingPlanGroupDetail } from "../types/selling-plans";
import { formatFrequency } from "../utils/formatting";
import {
  getFailedBillings,
  getUpcomingBillings,
  retryBilling,
} from "../services/subscription-billing.server";
import { formatDatePacific } from "../utils/timezone.server";
import { createSubscriptionFromContract } from "../services/subscription.server";
import prisma from "../db.server";
import { checkWebhookHealth, registerAllWebhooks } from "../services/webhook-registration.server";
import {
  getPlanGroups,
  ensureDefaultPlanGroups,
  createPlanGroup,
  updatePlanGroup,
  deletePlanGroup,
  addFrequency,
  updateFrequency,
  deleteFrequency,
  addProductsToGroup,
  removeProductFromGroup,
  ensureFrequencySortOrder,
} from "../services/subscription-plans.server";
import type { PlanProductInput } from "../services/subscription-plans.server";
import {
  syncDiscountsForGroup,
  syncAllDiscounts,
  deleteDiscountCode,
} from "../services/shopify-discounts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Ensure SSMA default plan groups exist
  await ensureDefaultPlanGroups(shop);

  // Fix frequency sortOrder if needed (fixes records created before sortOrder was introduced)
  await ensureFrequencySortOrder(shop);

  // Get all SSMA plan groups
  const planGroups = await getPlanGroups(shop);

  // Get selling plan configuration from our database
  const sellingPlanConfig = await getSellingPlanConfig(shop);

  // Get ALL selling plan groups from Shopify (includes plans created outside our app)
  let sellingPlanGroups = await getAllSellingPlanGroups(admin);

  // If Shopify returns no groups but we have a local config, create a synthetic entry
  // This handles the case where we can CREATE selling plans but can't READ them back
  // (possibly due to eventual consistency or permission quirks)
  let usingLocalConfig = false;
  if (sellingPlanGroups.length === 0 && sellingPlanConfig) {
    usingLocalConfig = true;

    // Build plans array from default plans + additional plans
    const plans = [
      ...(sellingPlanConfig.weeklyPlanId ? [{
        id: sellingPlanConfig.weeklyPlanId,
        name: `Deliver every week (${sellingPlanConfig.weeklyDiscount}% off)`,
        interval: "WEEK",
        intervalCount: 1,
        discount: sellingPlanConfig.weeklyDiscount,
        discountType: "PERCENTAGE",
        productCount: 0,
      }] : []),
      ...(sellingPlanConfig.biweeklyPlanId ? [{
        id: sellingPlanConfig.biweeklyPlanId,
        name: `Deliver every 2 weeks (${sellingPlanConfig.biweeklyDiscount}% off)`,
        interval: "WEEK",
        intervalCount: 2,
        discount: sellingPlanConfig.biweeklyDiscount,
        discountType: "PERCENTAGE",
        productCount: 0,
      }] : []),
      // Include additional plans from database
      ...(sellingPlanConfig.additionalPlans || []).map((plan) => ({
        id: plan.shopifyPlanId,
        name: plan.name,
        interval: plan.interval,
        intervalCount: plan.intervalCount,
        discount: plan.discount,
        discountType: plan.discountType,
        productCount: 0,
      })),
    ];

    sellingPlanGroups = [{
      id: sellingPlanConfig.groupId,
      name: sellingPlanConfig.groupName || "Subscribe & Save",
      productCount: 0, // Unknown without API access
      products: [], // Empty when using local config
      plans,
    }];
  }

  // Get failed billings
  const failedBillingsRaw = await getFailedBillings(shop);

  // Get upcoming billings (next 7 days)
  const upcomingBillingsRaw = await getUpcomingBillings(shop, 7);

  // Format dates on the server side to avoid importing server-only modules in client code
  const failedBillings = failedBillingsRaw.map((sub) => ({
    ...sub,
    lastBillingAttemptAtFormatted: sub.lastBillingAttemptAt
      ? new Date(sub.lastBillingAttemptAt).toLocaleDateString()
      : "-",
  }));

  const upcomingBillings = upcomingBillingsRaw.map((sub) => ({
    ...sub,
    nextBillingDateFormatted: sub.nextBillingDate
      ? formatDatePacific(new Date(sub.nextBillingDate), {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "-",
    nextPickupDateFormatted: sub.nextPickupDate
      ? formatDatePacific(new Date(sub.nextPickupDate), {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "-",
  }));

  // Build customer subscription management URL
  const customerPortalUrl = `https://${shop}/apps/my-subscription`;

  // Check webhook health
  let webhookHealth = { healthy: false, missing: [] as string[], registered: [] as string[], wrongUrl: [] as string[] };
  try {
    webhookHealth = await checkWebhookHealth(admin);
  } catch (error) {
    console.error("Failed to check webhook health:", error);
  }

  return json({
    shop,
    planGroups,
    sellingPlanConfig,
    sellingPlanGroups,
    usingLocalConfig,
    failedBillings,
    upcomingBillings,
    customerPortalUrl,
    webhookHealth,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "create_selling_plans": {
        const config = await ensureSellingPlanGroup(shop, admin);
        return json({
          success: true,
          message: "Selling plan group created successfully",
          config,
        });
      }

      case "add_products": {
        const productIdsStr = formData.get("productIds") as string;
        const groupId = formData.get("groupId") as string;
        if (!productIdsStr) {
          return json({ error: "No product IDs provided" }, { status: 400 });
        }
        const productIds = productIdsStr.split(",").map((id) => id.trim()).filter(Boolean);

        // If a specific group is specified, use direct GraphQL call
        if (groupId) {
          const response = await admin.graphql(`
            mutation addProductsToSellingPlanGroup($id: ID!, $productIds: [ID!]!) {
              sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
                sellingPlanGroup {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `, {
            variables: { id: groupId, productIds },
          });

          const data = await response.json();
          if (data.data?.sellingPlanGroupAddProducts?.userErrors?.length > 0) {
            const errors = data.data.sellingPlanGroupAddProducts.userErrors
              .map((e: { message: string }) => e.message)
              .join(", ");
            return json({ error: errors }, { status: 400 });
          }
        } else {
          await addProductsToSellingPlanGroup(shop, admin, productIds);
        }

        return json({
          success: true,
          message: `Added ${productIds.length} product(s) to subscription plan`,
        });
      }

      case "remove_product": {
        const productId = formData.get("productId") as string;
        const groupId = formData.get("groupId") as string;
        if (!productId || !groupId) {
          return json({ error: "Missing product or group ID" }, { status: 400 });
        }

        const response = await admin.graphql(`
          mutation removeProductFromSellingPlanGroup($id: ID!, $productIds: [ID!]!) {
            sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
              removedProductIds
              userErrors {
                field
                message
              }
            }
          }
        `, {
          variables: { id: groupId, productIds: [productId] },
        });

        const data = await response.json();
        if (data.data?.sellingPlanGroupRemoveProducts?.userErrors?.length > 0) {
          const errors = data.data.sellingPlanGroupRemoveProducts.userErrors
            .map((e: { message: string }) => e.message)
            .join(", ");
          return json({ error: errors }, { status: 400 });
        }

        return json({
          success: true,
          message: "Product removed from subscription plan",
        });
      }

      case "retry_billing": {
        const subscriptionId = formData.get("subscriptionId") as string;
        if (!subscriptionId) {
          return json({ error: "No subscription ID provided" }, { status: 400 });
        }
        await retryBilling(shop, admin, subscriptionId);
        return json({
          success: true,
          message: "Billing retry initiated",
        });
      }

      case "add_selling_plan": {
        const groupId = formData.get("groupId") as string;
        const planName = formData.get("planName") as string;
        const intervalCount = parseInt(formData.get("intervalCount") as string, 10);
        const discountPercent = parseFloat(formData.get("discountPercent") as string);
        const interval = (formData.get("interval") as string) || "WEEK";

        if (!groupId || !planName || isNaN(intervalCount) || isNaN(discountPercent)) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const result = await addSellingPlanToGroup(
          admin,
          shop,
          groupId,
          planName,
          intervalCount,
          discountPercent,
          interval
        );

        if (!result.success) {
          return json({ error: result.error }, { status: 400 });
        }

        return json({
          success: true,
          message: `Created new plan: ${planName}`,
        });
      }

      case "delete_selling_plan": {
        const groupId = formData.get("groupId") as string;
        const planId = formData.get("planId") as string;

        if (!groupId || !planId) {
          return json({ error: "Missing group or plan ID" }, { status: 400 });
        }

        const result = await deleteSellingPlan(admin, shop, groupId, planId);

        if (!result.success) {
          return json({ error: result.error }, { status: 400 });
        }

        return json({
          success: true,
          message: "Selling plan deleted",
        });
      }

      case "manual_sync_contract": {
        const orderInput = formData.get("contractId") as string;

        if (!orderInput) {
          return json({ error: "No order number or contract ID provided" }, { status: 400 });
        }

        let contract: {
          id: string;
          status: string;
          customer: { id: string; email: string; firstName: string; lastName: string; phone: string | null } | null;
          billingPolicy: { interval: string; intervalCount: number };
          deliveryPolicy: { interval: string; intervalCount: number };
        } | null = null;

        // Check if it's a contract GID or an order number/name
        if (orderInput.startsWith("gid://shopify/SubscriptionContract/")) {
          // Direct contract ID lookup
          const response = await admin.graphql(`
            query getSubscriptionContract($id: ID!) {
              subscriptionContract(id: $id) {
                id
                status
                customer {
                  id
                  email
                  firstName
                  lastName
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
              }
            }
          `, {
            variables: { id: orderInput },
          });

          const data = await response.json();
          contract = data.data?.subscriptionContract;
        } else {
          // Assume it's an order number - look up the order first
          // Clean up the input - add # if not present (Shopify stores names with #)
          const orderName = orderInput.startsWith("#") ? orderInput : `#${orderInput}`;

          // Find the order by name - use exact match with quotes
          const orderResponse = await admin.graphql(`
            query getOrderByName($query: String!) {
              orders(first: 1, query: $query) {
                nodes {
                  id
                  name
                  tags
                  customAttributes {
                    key
                    value
                  }
                  lineItems(first: 10) {
                    nodes {
                      name
                      sellingPlan {
                        sellingPlanId
                        name
                      }
                    }
                  }
                }
              }
            }
          `, {
            variables: { query: `name:"${orderName}"` },
          });

          const orderData = await orderResponse.json();
          const order = orderData.data?.orders?.nodes?.[0];

          if (!order) {
            return json({ error: `Order "${orderInput}" not found` }, { status: 404 });
          }

          // Debug: uncomment to troubleshoot manual sync
          // console.log("Order data for manual sync:", JSON.stringify(order, null, 2));

          // Check if this order has a selling plan (subscription) on line items
          const hasSellingPlan = order.lineItems?.nodes?.some((item: { sellingPlan: { sellingPlanId: string } | null }) => item.sellingPlan?.sellingPlanId);

          // Also check custom attributes for subscription-related info
          const customAttrs = order.customAttributes || [];
          const getAttr = (key: string) => customAttrs.find((a: {key: string; value: string}) => a.key === key)?.value;
          const hasPickupInfo = getAttr("Pickup Date") && getAttr("Pickup Time Slot");

          // If no selling plan on line items but has pickup info, this might be a subscription
          // that wasn't properly linked - let's still try to find the contract
          if (!hasSellingPlan && !hasPickupInfo) {
            const lineItems = order.lineItems?.nodes || [];
            const tags = order.tags || [];
            const lineItemDetails = lineItems.map((item: { name: string; sellingPlan: { sellingPlanId: string; name: string } | null }) =>
              `"${item.name}": sellingPlan=${item.sellingPlan ? JSON.stringify(item.sellingPlan) : "null"}`
            ).join("; ");
            return json({
              error: `Order "${orderInput}" doesn't have a sellingPlan on line items and no pickup info. Tags: [${tags.join(", ")}], Line items: ${lineItems.length} (${lineItemDetails}), Custom attributes: ${customAttrs.map((a: {key: string, value: string}) => `${a.key}=${a.value}`).join(", ") || "none"}`
            }, { status: 400 });
          }

          // Now get the subscription contracts and find one associated with this customer/order
          // We'll search for recent contracts created around the same time
          const contractsResponse = await admin.graphql(`
            query getRecentContracts {
              subscriptionContracts(first: 50, reverse: true) {
                nodes {
                  id
                  status
                  createdAt
                  customer {
                    id
                    email
                    firstName
                    lastName
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
                  originOrder {
                    id
                  }
                }
              }
            }
          `);

          const contractsData = await contractsResponse.json();
          const contracts = contractsData.data?.subscriptionContracts?.nodes || [];

          // Find contract matching the order
          contract = contracts.find((c: { originOrder?: { id: string } }) => c.originOrder?.id === order.id);

          // If no contract found but we have pickup info, we can create a subscription
          // record directly from the order data
          if (!contract && hasPickupInfo) {
            // Get customer info from order
            const orderDetailResponse = await admin.graphql(`
              query getOrderDetail($id: ID!) {
                order(id: $id) {
                  id
                  name
                  customer {
                    id
                    email
                    firstName
                    lastName
                    phone
                  }
                }
              }
            `, {
              variables: { id: order.id },
            });

            const orderDetail = (await orderDetailResponse.json()).data?.order;
            const customer = orderDetail?.customer;

            const customerName = customer
              ? `${customer.firstName || ""} ${customer.lastName || ""}`.trim()
              : "Unknown Customer";
            const customerEmail = customer?.email || null;
            const customerPhone = customer?.phone || null;

            // Parse pickup date to get preferred day
            const pickupDateStr = getAttr("Pickup Date");
            const pickupTimeSlot = getAttr("Pickup Time Slot") || "12:00 PM - 2:00 PM";

            // Try to determine the day of week from the pickup date
            let preferredDay = 5; // Default to Friday
            if (pickupDateStr) {
              // Try to parse day name from string like "Friday, February 20"
              const dayMatch = pickupDateStr.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i);
              if (dayMatch) {
                const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                preferredDay = dayNames.findIndex(d => d.toLowerCase() === dayMatch[1].toLowerCase());
              }
            }

            // Default to BIWEEKLY since that's what was selected
            // In the future, we could try to detect this from order notes or metafields
            const frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY" = "BIWEEKLY";

            // Check if already synced by order ID
            const existingByOrder = await prisma.subscriptionPickup.findFirst({
              where: {
                shop,
                shopifyContractId: order.id, // Use order ID as contract ID placeholder
              },
            });

            if (existingByOrder) {
              return json({ error: "This order has already been synced as a subscription" }, { status: 400 });
            }

            // Create the subscription using order ID as the contract reference
            const subscriptionId = await createSubscriptionFromContract(
              shop,
              order.id, // Use order ID since there's no contract
              customerName,
              customerEmail,
              customerPhone,
              frequency,
              preferredDay,
              pickupTimeSlot
            );

            // Also create a pickup schedule for the first pickup date
            let pickupDate: Date | null = null;
            if (pickupDateStr) {
              // Try to parse date from string like "Friday, February 20 (2025-02-20)" or "Friday, February 20"
              const isoMatch = pickupDateStr.match(/\((\d{4}-\d{2}-\d{2})\)/);
              if (isoMatch) {
                pickupDate = new Date(isoMatch[1] + "T12:00:00");
              } else {
                // Try parsing without ISO date
                pickupDate = new Date(pickupDateStr);
                if (isNaN(pickupDate.getTime())) {
                  pickupDate = null;
                }
              }
            }

            if (pickupDate) {
              // Create pickup schedule
              await prisma.pickupSchedule.create({
                data: {
                  shop,
                  shopifyOrderId: order.id,
                  shopifyOrderNumber: order.name,
                  customerName,
                  customerEmail,
                  customerPhone,
                  pickupDate,
                  pickupTimeSlot,
                  pickupStatus: "SCHEDULED",
                  subscriptionPickupId: subscriptionId,
                },
              });
            }

            return json({
              success: true,
              message: `Successfully created subscription for ${customerName} (no contract found, created from order data)${pickupDate ? ' with pickup schedule' : ''}`,
              subscriptionId,
            });
          }

          if (!contract) {
            return json({
              error: `Could not find subscription contract for order "${orderInput}". The contract may have been created by a different app or not created at all.`,
            }, { status: 404 });
          }
        }

        if (!contract) {
          return json({ error: "Subscription contract not found. Make sure the ID is correct and the contract was created by this app." }, { status: 404 });
        }

        // Check if already synced
        const existingSubscription = await prisma.subscriptionPickup.findFirst({
          where: {
            shop,
            shopifyContractId: contract.id,
          },
        });

        if (existingSubscription) {
          return json({ error: "This subscription contract has already been synced" }, { status: 400 });
        }

        // Extract customer info
        const customerName = `${contract.customer?.firstName || ""} ${contract.customer?.lastName || ""}`.trim() || "Unknown Customer";
        const customerEmail = contract.customer?.email || null;
        const customerPhone = contract.customer?.phone || null;

        // Determine frequency from billing policy
        let frequency: "WEEKLY" | "BIWEEKLY" | "TRIWEEKLY";
        switch (contract.billingPolicy.intervalCount) {
          case 1:
            frequency = "WEEKLY";
            break;
          case 2:
            frequency = "BIWEEKLY";
            break;
          case 3:
            frequency = "TRIWEEKLY";
            break;
          default:
            frequency = "WEEKLY";
        }

        // Get the origin order to find pickup info
        const originOrderResponse = await admin.graphql(`
          query getOriginOrder($contractId: ID!) {
            subscriptionContract(id: $contractId) {
              originOrder {
                id
                name
                customAttributes {
                  key
                  value
                }
              }
            }
          }
        `, {
          variables: { contractId: contract.id },
        });

        const originOrderData = await originOrderResponse.json();
        const originOrder = originOrderData.data?.subscriptionContract?.originOrder;
        const orderAttrs = originOrder?.customAttributes || [];
        const getOrderAttr = (key: string) => orderAttrs.find((a: {key: string; value: string}) => a.key === key)?.value;

        const pickupDateStr = getOrderAttr("Pickup Date");
        const pickupTimeSlot = getOrderAttr("Pickup Time Slot") || "12:00 PM - 2:00 PM";

        // Parse pickup date to get preferred day
        let preferredDay = 2; // Default to Tuesday
        let pickupDate: Date | null = null;

        if (pickupDateStr) {
          // Try to parse day name from string like "Friday, February 20"
          const dayMatch = pickupDateStr.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i);
          if (dayMatch) {
            const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            preferredDay = dayNames.findIndex(d => d.toLowerCase() === dayMatch[1].toLowerCase());
          }

          // Try to parse full date
          const isoMatch = pickupDateStr.match(/\((\d{4}-\d{2}-\d{2})\)/);
          if (isoMatch) {
            pickupDate = new Date(isoMatch[1] + "T12:00:00");
          } else {
            const parsed = new Date(pickupDateStr);
            if (!isNaN(parsed.getTime())) {
              pickupDate = parsed;
            }
          }
        }

        // Create the subscription
        const subscriptionId = await createSubscriptionFromContract(
          shop,
          contract.id,
          customerName,
          customerEmail,
          customerPhone,
          frequency,
          preferredDay,
          pickupTimeSlot
        );

        // Also create pickup schedule if we have the order info
        let pickupScheduleCreated = false;
        if (originOrder && pickupDate) {
          try {
            await prisma.pickupSchedule.create({
              data: {
                shop,
                shopifyOrderId: originOrder.id,
                shopifyOrderNumber: originOrder.name,
                customerName,
                customerEmail,
                customerPhone,
                pickupDate,
                pickupTimeSlot,
                pickupStatus: "SCHEDULED",
                subscriptionPickupId: subscriptionId,
              },
            });
            pickupScheduleCreated = true;
          } catch (pickupError) {
            console.error("Failed to create pickup schedule:", pickupError);
            // Continue - subscription was still created
          }
        }

        return json({
          success: true,
          message: `Successfully synced subscription for ${customerName}${pickupScheduleCreated ? ' with pickup schedule' : ' (no pickup schedule - missing order info)'}`,
          subscriptionId,
        });
      }

      case "create_plan_group": {
        const name = formData.get("name") as string;
        const billingLeadHours = parseInt(formData.get("billingLeadHours") as string, 10);
        const isActive = formData.get("isActive") === "true";
        if (!name || isNaN(billingLeadHours)) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }
        const group = await createPlanGroup(shop, { name, billingLeadHours, isActive });
        return json({ success: true, message: `Created plan group: ${group.name}` });
      }

      case "update_plan_group": {
        const groupId = formData.get("groupId") as string;
        const name = formData.get("name") as string;
        const billingLeadHours = parseInt(formData.get("billingLeadHours") as string, 10);
        const isActive = formData.get("isActive") === "true";
        if (!groupId || !name || isNaN(billingLeadHours)) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }
        const group = await updatePlanGroup(shop, groupId, { name, billingLeadHours, isActive });
        return json({ success: true, message: `Updated plan group: ${group.name}` });
      }

      case "delete_plan_group": {
        const groupId = formData.get("groupId") as string;
        if (!groupId) return json({ error: "Missing group ID" }, { status: 400 });
        // Delete Shopify discount codes for all frequencies in this group first
        const groupToDeleteData = await prisma.subscriptionPlanGroup.findFirst({
          where: { id: groupId, shop },
          include: { frequencies: true },
        });
        if (groupToDeleteData) {
          for (const freq of groupToDeleteData.frequencies) {
            if (freq.shopifyDiscountId) {
              await deleteDiscountCode(admin, freq.shopifyDiscountId);
            }
          }
        }
        await deletePlanGroup(shop, groupId);
        return json({ success: true, message: "Plan group deleted" });
      }

      case "add_frequency": {
        const groupId = formData.get("groupId") as string;
        const name = formData.get("name") as string;
        const interval = formData.get("interval") as string;
        const intervalCount = parseInt(formData.get("intervalCount") as string, 10);
        const discountPercent = parseFloat(formData.get("discountPercent") as string);
        const discountCode = (formData.get("discountCode") as string) || null;
        const isActive = formData.get("isActive") === "true";
        if (!groupId || !name || !interval || isNaN(intervalCount) || isNaN(discountPercent)) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }
        // Auto-set sortOrder: find the max sortOrder in this group and add 1
        const existingFreqs = await prisma.subscriptionPlanFrequency.findMany({
          where: { groupId },
          select: { sortOrder: true },
        });
        const maxSortOrder = existingFreqs.length > 0
          ? Math.max(...existingFreqs.map((f) => f.sortOrder))
          : -1;
        const sortOrder = maxSortOrder + 1;
        const freq = await addFrequency(shop, groupId, { name, interval, intervalCount, discountPercent, discountCode, isActive, sortOrder });
        // Auto-sync discount code and selling plan to Shopify
        await syncDiscountsForGroup(admin, shop, groupId);
        await syncSellingPlansFromSSMA(admin, shop);
        return json({ success: true, message: `Added frequency: ${freq.name}` });
      }

      case "update_frequency": {
        const frequencyId = formData.get("frequencyId") as string;
        const name = formData.get("name") as string;
        const interval = formData.get("interval") as string;
        const intervalCount = parseInt(formData.get("intervalCount") as string, 10);
        const discountPercent = parseFloat(formData.get("discountPercent") as string);
        const discountCode = (formData.get("discountCode") as string) || null;
        const isActive = formData.get("isActive") === "true";
        if (!frequencyId || !name || !interval || isNaN(intervalCount) || isNaN(discountPercent)) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }
        const freq = await updateFrequency(shop, frequencyId, { name, interval, intervalCount, discountPercent, discountCode, isActive });
        // Auto-sync discount code to Shopify (find parent group)
        const freqGroup = await prisma.subscriptionPlanFrequency.findFirst({
          where: { id: frequencyId },
          include: { group: { select: { id: true } } },
        });
        if (freqGroup) {
          await syncDiscountsForGroup(admin, shop, freqGroup.group.id);
        }
        // Auto-sync selling plans to Shopify
        await syncSellingPlansFromSSMA(admin, shop);
        return json({ success: true, message: `Updated frequency: ${freq.name}` });
      }

      case "delete_frequency": {
        const frequencyId = formData.get("frequencyId") as string;
        if (!frequencyId) return json({ error: "Missing frequency ID" }, { status: 400 });
        // Delete associated Shopify discount code first
        const freqToDeleteData = await prisma.subscriptionPlanFrequency.findFirst({
          where: { id: frequencyId },
        });
        if (freqToDeleteData?.shopifyDiscountId) {
          await deleteDiscountCode(admin, freqToDeleteData.shopifyDiscountId);
        }
        await deleteFrequency(shop, frequencyId);
        // Note: We don't auto-delete the Shopify selling plan here for safety
        // (active subscriptions may depend on it). Use the Debug page to manage selling plans manually.
        return json({ success: true, message: "Frequency deleted" });
      }

      case "add_group_products": {
        const groupId = formData.get("groupId") as string;
        const productsJson = formData.get("products") as string;
        if (!groupId || !productsJson) {
          return json({ error: "Missing fields" }, { status: 400 });
        }
        const products: PlanProductInput[] = JSON.parse(productsJson);
        const count = await addProductsToGroup(shop, groupId, products);
        // Re-sync discount codes with updated product targeting
        await syncDiscountsForGroup(admin, shop, groupId);
        return json({ success: true, message: `Added ${count} product(s) to plan group` });
      }

      case "remove_group_product": {
        const groupId = formData.get("groupId") as string;
        const productRecordId = formData.get("productRecordId") as string;
        if (!groupId || !productRecordId) {
          return json({ error: "Missing fields" }, { status: 400 });
        }
        await removeProductFromGroup(shop, groupId, productRecordId);
        // Re-sync discount codes with updated product targeting
        await syncDiscountsForGroup(admin, shop, groupId);
        return json({ success: true, message: "Product removed from plan group" });
      }

      case "sync_discounts": {
        const syncResult = await syncAllDiscounts(admin, shop);
        if (syncResult.failed > 0) {
          const parts = [];
          if (syncResult.created > 0) parts.push(`${syncResult.created} created`);
          if (syncResult.updated > 0) parts.push(`${syncResult.updated} updated`);
          parts.push(`${syncResult.failed} failed`);
          return json({
            error: `Discount sync partially failed (${parts.join(", ")}): ${syncResult.errors.join("; ")}`,
          });
        }
        const parts = [];
        if (syncResult.created > 0) parts.push(`${syncResult.created} created`);
        if (syncResult.updated > 0) parts.push(`${syncResult.updated} updated`);
        if (syncResult.deleted > 0) parts.push(`${syncResult.deleted} deleted`);
        const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        return json({ success: true, message: `All discount codes synced to Shopify${summary}` });
      }

      case "sync_selling_plans": {
        const spResult = await syncSellingPlansFromSSMA(admin, shop);
        if (spResult.success) {
          return json({ success: true, message: spResult.message });
        }
        return json({ error: spResult.message });
      }

      case "register_webhooks": {
        const result = await registerAllWebhooks(admin);

        if (result.success) {
          const messages = [];
          if (result.registered.length > 0) {
            messages.push(`Registered: ${result.registered.join(", ")}`);
          }
          if (result.alreadyExists.length > 0) {
            messages.push(`Already exists: ${result.alreadyExists.join(", ")}`);
          }
          return json({
            success: true,
            message: `Webhooks registered successfully. ${messages.join(". ")}`,
          });
        } else {
          const failedTopics = result.failed.map(f => `${f.topic}: ${f.error}`).join("; ");
          return json({
            error: `Some webhooks failed to register: ${failedTopics}`,
          }, { status: 500 });
        }
      }

      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: String(error) }, { status: 500 });
  }
};

export default function SubscriptionsSettings() {
  const { planGroups, sellingPlanConfig, sellingPlanGroups, usingLocalConfig, failedBillings, upcomingBillings, customerPortalUrl, webhookHealth } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isLoading = navigation.state !== "idle";

  const [copied, setCopied] = useState(false);

  // Shopify Selling Plan - Add Plan Modal State (legacy)
  const [addPlanModalOpen, setAddPlanModalOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanInterval, setNewPlanInterval] = useState("WEEK");
  const [newPlanIntervalCount, setNewPlanIntervalCount] = useState("1");
  const [newPlanDiscount, setNewPlanDiscount] = useState("5");

  // Shopify Selling Plan - Delete confirmation state (legacy)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<{ groupId: string; planId: string; name: string } | null>(null);

  // Plan Group modal state
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<typeof planGroups[0] | null>(null);
  const [groupName, setGroupName] = useState("Subscribe & Save - Porch Pick Up");
  const [groupBillingLeadHours, setGroupBillingLeadHours] = useState("48");
  const [groupIsActive, setGroupIsActive] = useState(true);

  // Frequency modal state
  const [freqModalOpen, setFreqModalOpen] = useState(false);
  const [freqGroupId, setFreqGroupId] = useState("");
  const [editingFreq, setEditingFreq] = useState<typeof planGroups[0]["frequencies"][0] | null>(null);
  const [freqName, setFreqName] = useState("");
  const [freqInterval, setFreqInterval] = useState("WEEK");
  const [freqIntervalCount, setFreqIntervalCount] = useState("1");
  const [freqDiscount, setFreqDiscount] = useState("10");
  const [freqDiscountCode, setFreqDiscountCode] = useState("");
  const [freqIsActive, setFreqIsActive] = useState(true);

  // Delete confirmation states
  const [deleteGroupConfirmOpen, setDeleteGroupConfirmOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteFreqConfirmOpen, setDeleteFreqConfirmOpen] = useState(false);
  const [freqToDelete, setFreqToDelete] = useState<{ id: string; name: string } | null>(null);

  // Expanded groups for product lists (reuse existing pattern)
  const [expandedPlanGroups, setExpandedPlanGroups] = useState<Set<string>>(new Set());

  // Debug/Advanced section state
  const [debugSectionOpen, setDebugSectionOpen] = useState(false);

  // Manual sync state
  const [contractId, setContractId] = useState("");

  // Product management state (for Shopify selling plan groups)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Toggle product list visibility for a Shopify selling plan group
  const toggleGroupProducts = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  }, []);

  // Open Shopify Resource Picker to select products (for Shopify selling plan groups)
  const handleOpenProductPicker = useCallback(async (groupId: string) => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        selectionIds: [], // Don't preselect - we want to add new products
        filter: {
          variants: false,
        },
      });

      if (selected && selected.length > 0) {
        const productIds = selected.map((product: { id: string }) => product.id).join(",");
        submit({ intent: "add_products", productIds, groupId }, { method: "post" });
      }
    } catch (err) {
      console.error("Resource picker error:", err);
    }
  }, [shopify, submit]);

  // Remove a product from a selling plan group
  const handleRemoveProduct = useCallback((groupId: string, productId: string) => {
    submit({ intent: "remove_product", groupId, productId }, { method: "post" });
  }, [submit]);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(customerPortalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [customerPortalUrl]);

  const handleCreateSellingPlans = () => {
    submit({ intent: "create_selling_plans" }, { method: "post" });
  };

  const handleRetryBilling = (subscriptionId: string) => {
    submit({ intent: "retry_billing", subscriptionId }, { method: "post" });
  };

  const handleOpenAddPlanModal = (groupId: string) => {
    setSelectedGroupId(groupId);
    setNewPlanName("");
    setNewPlanInterval("WEEK");
    setNewPlanIntervalCount("1");
    setNewPlanDiscount("5");
    setAddPlanModalOpen(true);
  };

  const handleAddPlan = () => {
    const intervalCount = parseInt(newPlanIntervalCount, 10);
    const discount = parseFloat(newPlanDiscount);

    // Generate plan name if not provided
    const planName = newPlanName ||
      `Deliver ${formatFrequency(newPlanInterval, intervalCount)} (${discount}% off)`;

    submit({
      intent: "add_selling_plan",
      groupId: selectedGroupId,
      planName,
      interval: newPlanInterval,
      intervalCount: newPlanIntervalCount,
      discountPercent: newPlanDiscount,
    }, { method: "post" });

    setAddPlanModalOpen(false);
  };

  const handleDeletePlan = (groupId: string, planId: string, name: string) => {
    setPlanToDelete({ groupId, planId, name });
    setDeleteConfirmOpen(true);
  };

  const confirmDeletePlan = () => {
    if (planToDelete) {
      submit({
        intent: "delete_selling_plan",
        groupId: planToDelete.groupId,
        planId: planToDelete.planId,
      }, { method: "post" });
    }
    setDeleteConfirmOpen(false);
    setPlanToDelete(null);
  };

  // Plan Group handlers
  const openGroupModal = useCallback((group?: typeof planGroups[0]) => {
    if (group) {
      setEditingGroup(group);
      setGroupName(group.name);
      setGroupBillingLeadHours(String(group.billingLeadHours));
      setGroupIsActive(group.isActive);
    } else {
      setEditingGroup(null);
      setGroupName("Subscribe & Save - Porch Pick Up");
      setGroupBillingLeadHours("48");
      setGroupIsActive(true);
    }
    setGroupModalOpen(true);
  }, []);

  const handleSaveGroup = useCallback(() => {
    const data: Record<string, string> = {
      name: groupName,
      billingLeadHours: groupBillingLeadHours,
      isActive: groupIsActive ? "true" : "false",
    };
    if (editingGroup) {
      data.intent = "update_plan_group";
      data.groupId = editingGroup.id;
    } else {
      data.intent = "create_plan_group";
    }
    submit(data, { method: "post" });
    setGroupModalOpen(false);
  }, [editingGroup, groupName, groupBillingLeadHours, groupIsActive, submit]);

  const handleDeleteGroup = useCallback((group: typeof planGroups[0]) => {
    setGroupToDelete({ id: group.id, name: group.name });
    setDeleteGroupConfirmOpen(true);
  }, []);

  const confirmDeleteGroup = useCallback(() => {
    if (groupToDelete) {
      submit({ intent: "delete_plan_group", groupId: groupToDelete.id }, { method: "post" });
    }
    setDeleteGroupConfirmOpen(false);
    setGroupToDelete(null);
  }, [groupToDelete, submit]);

  // Frequency handlers
  const openFreqModal = useCallback((groupId: string, freq?: typeof planGroups[0]["frequencies"][0]) => {
    setFreqGroupId(groupId);
    if (freq) {
      setEditingFreq(freq);
      setFreqName(freq.name);
      setFreqInterval(freq.interval);
      setFreqIntervalCount(String(freq.intervalCount));
      setFreqDiscount(String(freq.discountPercent));
      setFreqDiscountCode(freq.discountCode || "");
      setFreqIsActive(freq.isActive);
    } else {
      setEditingFreq(null);
      setFreqName("");
      setFreqInterval("WEEK");
      setFreqIntervalCount("1");
      setFreqDiscount("5");
      setFreqDiscountCode("");
      setFreqIsActive(true);
    }
    setFreqModalOpen(true);
  }, []);

  const handleSaveFreq = useCallback(() => {
    const data: Record<string, string> = {
      name: freqName,
      interval: freqInterval,
      intervalCount: freqIntervalCount,
      discountPercent: freqDiscount,
      discountCode: freqDiscountCode,
      isActive: freqIsActive ? "true" : "false",
    };
    if (editingFreq) {
      data.intent = "update_frequency";
      data.frequencyId = editingFreq.id;
    } else {
      data.intent = "add_frequency";
      data.groupId = freqGroupId;
    }
    submit(data, { method: "post" });
    setFreqModalOpen(false);
  }, [editingFreq, freqGroupId, freqName, freqInterval, freqIntervalCount, freqDiscount, freqDiscountCode, freqIsActive, submit]);

  const handleDeleteFreq = useCallback((freq: typeof planGroups[0]["frequencies"][0]) => {
    setFreqToDelete({ id: freq.id, name: freq.name });
    setDeleteFreqConfirmOpen(true);
  }, []);

  const confirmDeleteFreq = useCallback(() => {
    if (freqToDelete) {
      submit({ intent: "delete_frequency", frequencyId: freqToDelete.id }, { method: "post" });
    }
    setDeleteFreqConfirmOpen(false);
    setFreqToDelete(null);
  }, [freqToDelete, submit]);

  // Product handlers for SSMA plan groups
  const handleOpenProductPickerForGroup = useCallback(async (groupId: string) => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        selectionIds: [],
        filter: { variants: false },
      });
      if (selected && selected.length > 0) {
        const products = selected.map((p: { id: string; title: string; images?: Array<{ originalSrc?: string }> }) => ({
          shopifyProductId: p.id,
          title: p.title,
          imageUrl: p.images?.[0]?.originalSrc || null,
        }));
        submit(
          { intent: "add_group_products", groupId, products: JSON.stringify(products) },
          { method: "post" }
        );
      }
    } catch (err) {
      console.error("Resource picker error:", err);
    }
  }, [shopify, submit]);

  const handleRemoveGroupProduct = useCallback((groupId: string, productRecordId: string) => {
    submit({ intent: "remove_group_product", groupId, productRecordId }, { method: "post" });
  }, [submit]);

  const togglePlanGroupProducts = useCallback((groupId: string) => {
    setExpandedPlanGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  }, []);

  // Close modals on successful action
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      setGroupModalOpen(false);
      setFreqModalOpen(false);
      setDeleteGroupConfirmOpen(false);
      setDeleteFreqConfirmOpen(false);
    }
  }, [actionData]);

  const handleManualSync = () => {
    if (!contractId.trim()) return;
    submit({ intent: "manual_sync_contract", contractId: contractId.trim() }, { method: "post" });
    setContractId("");
  };

  // Format failed billings for data table
  const failedBillingsRows = failedBillings.map((sub) => [
    sub.customerName,
    sub.customerEmail || "-",
    sub.frequency,
    sub.billingFailureCount.toString(),
    sub.billingFailureReason || "Unknown error",
    sub.lastBillingAttemptAtFormatted,
    <Button
      key={sub.id}
      size="slim"
      onClick={() => handleRetryBilling(sub.id)}
      loading={isLoading}
    >
      Retry
    </Button>,
  ]);

  // Format upcoming billings for data table
  const upcomingBillingsRows = upcomingBillings.map((sub) => [
    sub.customerName,
    sub.frequency,
    sub.nextBillingDateFormatted,
    sub.nextPickupDateFormatted,
    <Badge key={sub.id} tone="success">
      Active
    </Badge>,
  ]);

  return (
    <Page>
      <TitleBar title="Subscription Settings" />
      <Layout>
        {/* Success/Error Messages */}
        {actionData && "success" in actionData && actionData.success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => {}}>
              {actionData.message}
            </Banner>
          </Layout.Section>
        )}
        {actionData && "error" in actionData && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => {}}>
              {actionData.error}
            </Banner>
          </Layout.Section>
        )}

        {/* Webhook Health Status */}
        {!webhookHealth.healthy && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Webhook Configuration
                  </Text>
                  <Badge tone="critical">Action Required</Badge>
                </InlineStack>

                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p">
                      Order webhooks are not properly configured. Orders placed in your store will not automatically sync to SSMA.
                    </Text>
                    {webhookHealth.missing.length > 0 && (
                      <Text as="p" tone="subdued">
                        Missing webhooks: {webhookHealth.missing.join(", ")}
                      </Text>
                    )}
                    {webhookHealth.wrongUrl.length > 0 && (
                      <Text as="p" tone="subdued">
                        Webhooks with incorrect URL: {webhookHealth.wrongUrl.join(", ")}
                      </Text>
                    )}
                  </BlockStack>
                </Banner>

                <Button
                  variant="primary"
                  onClick={() => {
                    const formData = new FormData();
                    formData.append("intent", "register_webhooks");
                    submit(formData, { method: "post" });
                  }}
                  loading={isLoading}
                >
                  Register Webhooks
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {webhookHealth.healthy && (
          <Layout.Section>
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Webhook Configuration
                  </Text>
                  <Text as="p" tone="subdued">
                    {webhookHealth.registered.length} webhooks registered and working
                  </Text>
                </BlockStack>
                <Badge tone="success">Healthy</Badge>
              </InlineStack>
            </Card>
          </Layout.Section>
        )}

        {/* SSMA Subscription Plan Groups */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Subscription Plan Groups
                </Text>
                <InlineStack gap="200">
                  <Button
                    size="slim"
                    onClick={() => submit({ intent: "sync_selling_plans" }, { method: "post" })}
                    loading={isLoading}
                  >
                    Sync Selling Plans
                  </Button>
                  <Button
                    size="slim"
                    onClick={() => submit({ intent: "sync_discounts" }, { method: "post" })}
                    loading={isLoading}
                  >
                    Sync Discounts
                  </Button>
                  <Button size="slim" onClick={() => openGroupModal()}>
                    Add Plan Group
                  </Button>
                </InlineStack>
              </InlineStack>

              <Text as="p" tone="subdued">
                Each plan group contains delivery frequency options and associated products.
                Discount codes are automatically created and managed in Shopify.
              </Text>

              {planGroups.length === 0 ? (
                <Banner tone="info">
                  No plan groups configured. Click "Add Plan Group" to create one.
                </Banner>
              ) : (
                <BlockStack gap="400">
                  {planGroups.map((group) => (
                    <Box
                      key={group.id}
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="300">
                        {/* Group Header */}
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="h3" variant="headingSm">
                                {group.name}
                              </Text>
                              {group.isActive ? (
                                <Badge tone="success">Active</Badge>
                              ) : (
                                <Badge>Inactive</Badge>
                              )}
                              <Badge tone="info">{`${group.billingLeadHours}h billing lead`}</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {group.frequencies.length} frequency option(s) · {group.products.length} product(s)
                            </Text>
                          </BlockStack>
                          <InlineStack gap="200">
                            <Button size="slim" onClick={() => openFreqModal(group.id)}>
                              Add Frequency
                            </Button>
                            <Button size="slim" onClick={() => handleOpenProductPickerForGroup(group.id)}>
                              Add Products
                            </Button>
                            <Button size="slim" onClick={() => openGroupModal(group)}>
                              Edit
                            </Button>
                            <Button size="slim" tone="critical" onClick={() => handleDeleteGroup(group)}>
                              Delete
                            </Button>
                          </InlineStack>
                        </InlineStack>

                        <Divider />

                        {/* Frequencies */}
                        {group.frequencies.length === 0 ? (
                          <Text as="p" tone="subdued">
                            No frequency options. Click "Add Frequency" to create one.
                          </Text>
                        ) : (
                          <DataTable
                            columnContentTypes={["text", "text", "numeric", "text", "text", "text"]}
                            headings={["Name", "Frequency", "Discount", "Discount Code", "Status", "Actions"]}
                            rows={group.frequencies.map((freq) => [
                              freq.name,
                              freq.interval === "WEEK"
                                ? freq.intervalCount === 1 ? "Every week" : `Every ${freq.intervalCount} weeks`
                                : freq.intervalCount === 1 ? "Every month" : `Every ${freq.intervalCount} months`,
                              `${freq.discountPercent}%`,
                              <InlineStack key={`dc-${freq.id}`} gap="200" blockAlign="center">
                                <span>{freq.discountCode || "—"}</span>
                                {freq.discountCode && (freq as Record<string, unknown>).shopifyDiscountId ? (
                                  <Badge tone="success" key={`ds-${freq.id}`}>Synced</Badge>
                                ) : freq.discountCode ? (
                                  <Badge tone="attention" key={`ds-${freq.id}`}>Not synced</Badge>
                                ) : null}
                              </InlineStack>,
                              freq.isActive ? (
                                <Badge key={`fs-${freq.id}`} tone="success">Active</Badge>
                              ) : (
                                <Badge key={`fs-${freq.id}`}>Inactive</Badge>
                              ),
                              <InlineStack key={`fa-${freq.id}`} gap="200">
                                <Button size="slim" onClick={() => openFreqModal(group.id, freq)}>
                                  Edit
                                </Button>
                                <Button size="slim" tone="critical" onClick={() => handleDeleteFreq(freq)}>
                                  Delete
                                </Button>
                              </InlineStack>,
                            ])}
                          />
                        )}

                        <Divider />

                        {/* Products */}
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <Button
                              variant="plain"
                              onClick={() => togglePlanGroupProducts(group.id)}
                              icon={expandedPlanGroups.has(group.id) ? ChevronUpIcon : ChevronDownIcon}
                            >
                              {`${expandedPlanGroups.has(group.id) ? "Hide" : "Show"} Products (${group.products.length})`}
                            </Button>
                          </InlineStack>

                          <Collapsible
                            open={expandedPlanGroups.has(group.id)}
                            id={`plan-products-${group.id}`}
                          >
                            <Box paddingBlockStart="200">
                              {group.products.length === 0 ? (
                                <Banner tone="info">
                                  No products in this group. Click "Add Products" to browse and add products.
                                </Banner>
                              ) : (
                                <BlockStack gap="200">
                                  {group.products.map((product) => (
                                    <Box
                                      key={product.id}
                                      padding="200"
                                      background="bg-surface"
                                      borderRadius="100"
                                    >
                                      <InlineStack align="space-between" blockAlign="center" gap="300">
                                        <InlineStack gap="300" blockAlign="center">
                                          {product.imageUrl ? (
                                            <Thumbnail
                                              source={product.imageUrl}
                                              alt={product.title}
                                              size="small"
                                            />
                                          ) : (
                                            <Box
                                              background="bg-surface-secondary"
                                              padding="200"
                                              borderRadius="100"
                                            >
                                              <Icon source={ImageIcon} tone="subdued" />
                                            </Box>
                                          )}
                                          <Text as="span" variant="bodyMd">
                                            {product.title}
                                          </Text>
                                        </InlineStack>
                                        <Button
                                          size="slim"
                                          tone="critical"
                                          icon={DeleteIcon}
                                          onClick={() => handleRemoveGroupProduct(group.id, product.id)}
                                          accessibilityLabel={`Remove ${product.title}`}
                                        />
                                      </InlineStack>
                                    </Box>
                                  ))}
                                </BlockStack>
                              )}
                            </Box>
                          </Collapsible>
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Customer Subscription Management URL */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Customer Subscription Management URL
              </Text>
              <Text as="p" tone="subdued">
                Add this URL to your store's navigation so customers can manage their subscriptions.
                The best place is in the Account menu or Footer navigation.
              </Text>
              <Box
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodyMd" breakWord>
                    {customerPortalUrl}
                  </Text>
                  <Button
                    onClick={handleCopyUrl}
                    size="slim"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </InlineStack>
              </Box>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  How to add to your store:
                </Text>
                <Text as="p" variant="bodySm">
                  1. Go to <strong>Online Store → Navigation</strong> in your Shopify admin
                </Text>
                <Text as="p" variant="bodySm">
                  2. Edit your <strong>Account menu</strong> or <strong>Footer menu</strong>
                </Text>
                <Text as="p" variant="bodySm">
                  3. Add a new menu item with name "Manage Subscription" and link <code>/apps/my-subscription</code>
                </Text>
              </BlockStack>
              <Banner tone="info">
                Customers must be logged in to view their subscriptions. The portal will prompt them to log in if they're not.
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* Advanced / Debug Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Advanced / Debug
                </Text>
                <Button
                  variant="plain"
                  onClick={() => setDebugSectionOpen(!debugSectionOpen)}
                  icon={debugSectionOpen ? ChevronUpIcon : ChevronDownIcon}
                >
                  {debugSectionOpen ? "Hide" : "Show"}
                </Button>
              </InlineStack>

              <Collapsible open={debugSectionOpen} id="debug-section">
                <BlockStack gap="500">
                  {/* Manual Subscription Sync */}
                  <Box paddingBlockStart="300">
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Manual Subscription Sync</Text>
                      <Text as="p" tone="subdued">
                        If a subscription wasn't captured automatically, manually sync it by entering the order number.
                      </Text>
                      <FormLayout>
                        <TextField
                          label="Order Number"
                          value={contractId}
                          onChange={setContractId}
                          placeholder="#1829 or 1829"
                          autoComplete="off"
                          helpText="The order number from the subscription order"
                        />
                        <Button
                          onClick={handleManualSync}
                          disabled={!contractId.trim()}
                          loading={isLoading}
                        >
                          Sync Subscription
                        </Button>
                      </FormLayout>
                    </BlockStack>
                  </Box>

                  <Divider />

                  {/* How SSMA Works */}
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">How SSMA Subscriptions Work</Text>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm">
                        1. <strong>Cart Page:</strong> Customer selects "Subscribe and Save" and chooses frequency.
                      </Text>
                      <Text as="p" variant="bodySm">
                        2. <strong>Discount Applied:</strong> The widget automatically applies the corresponding discount code.
                      </Text>
                      <Text as="p" variant="bodySm">
                        3. <strong>Checkout:</strong> Customer selects their first pickup date and preferred day.
                      </Text>
                      <Text as="p" variant="bodySm">
                        4. <strong>Order Created:</strong> SSMA detects subscription attributes and creates the subscription record.
                      </Text>
                    </BlockStack>
                  </BlockStack>

                  <Divider />

                  {/* Shopify Selling Plans Reference */}
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">Shopify Selling Plans (Legacy Reference)</Text>
                      {sellingPlanGroups.length > 0 ? (
                        <Badge>{`${sellingPlanGroups.length} group(s)`}</Badge>
                      ) : (
                        <Badge tone="attention">None</Badge>
                      )}
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">
                      SSMA now uses its own subscription system with cart attributes and discount codes.
                      Existing selling plans from other apps are shown for reference only.
                    </Text>
                    {sellingPlanGroups.length > 0 && (
                      <BlockStack gap="200">
                        {sellingPlanGroups.map((group: SellingPlanGroupDetail) => (
                          <Box key={group.id} padding="200" background="bg-surface-secondary" borderRadius="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodySm" fontWeight="semibold">{group.name}</Text>
                              <Badge>{`${group.plans.length} plan(s)`}</Badge>
                              {group.isOwnedByCurrentApp ? (
                                <Badge tone="success">SSMA</Badge>
                              ) : (
                                <Badge tone="attention">External</Badge>
                              )}
                            </InlineStack>
                          </Box>
                        ))}
                      </BlockStack>
                    )}
                  </BlockStack>
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* Billing Information */}
        <Layout.Section>
          <Text as="h2" variant="headingLg">
            Billing Management
          </Text>
          <Text as="p" tone="subdued">
            Subscriptions are billed based on each plan's billing lead time (default 48 hours before pickup).
          </Text>
        </Layout.Section>

        {/* Failed Billings */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Failed Billings
                </Text>
                {failedBillings.length > 0 && (
                  <Badge tone="critical">{failedBillings.length.toString()}</Badge>
                )}
              </InlineStack>

              {failedBillings.length === 0 ? (
                <Text as="p" tone="subdued">
                  No failed billings. All subscriptions are billing successfully.
                </Text>
              ) : (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "numeric",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "Customer",
                    "Email",
                    "Frequency",
                    "Failures",
                    "Reason",
                    "Last Attempt",
                    "Action",
                  ]}
                  rows={failedBillingsRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Upcoming Billings */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Upcoming Billings (Next 7 Days)
                </Text>
                <Badge>{upcomingBillings.length.toString()}</Badge>
              </InlineStack>

              {upcomingBillings.length === 0 ? (
                <Text as="p" tone="subdued">
                  No upcoming billings in the next 7 days.
                </Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={[
                    "Customer",
                    "Frequency",
                    "Billing Date",
                    "Pickup Date",
                    "Status",
                  ]}
                  rows={upcomingBillingsRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Billing Schedule Explanation */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                How Billing Works
              </Text>
              <BlockStack gap="200">
                <Text as="p">
                  <strong>1. Initial Purchase:</strong> Customer is charged at checkout
                  for their first delivery.
                </Text>
                <Text as="p">
                  <strong>2. Recurring Billing:</strong> For subsequent deliveries,
                  customers are automatically charged based on the plan's billing lead time
                  (configurable per plan, default 48 hours before pickup).
                </Text>
                <Text as="p">
                  <strong>3. Example:</strong> If a customer has a Saturday 12:00 PM
                  pickup with 48h lead time, they will be billed Thursday at noon.
                </Text>
                <Text as="p">
                  <strong>4. Failures:</strong> If billing fails, we retry up to 3 times.
                  After 3 failures, the subscription is automatically paused.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Add Plan Modal (Shopify Selling Plans) */}
      <Modal
        open={addPlanModalOpen}
        onClose={() => setAddPlanModalOpen(false)}
        title="Add New Subscription Plan"
        primaryAction={{
          content: "Create Plan",
          onAction: handleAddPlan,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setAddPlanModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Plan Name (optional)"
              value={newPlanName}
              onChange={setNewPlanName}
              placeholder="e.g., Deliver every 3 weeks (2.5% off)"
              autoComplete="off"
              helpText="Leave blank to auto-generate based on frequency and discount"
            />
            <Select
              label="Billing Interval"
              options={[
                { label: "Week(s)", value: "WEEK" },
                { label: "Month(s)", value: "MONTH" },
              ]}
              value={newPlanInterval}
              onChange={setNewPlanInterval}
            />
            <TextField
              label="Interval Count"
              type="number"
              value={newPlanIntervalCount}
              onChange={setNewPlanIntervalCount}
              min={1}
              max={52}
              autoComplete="off"
              helpText={`Customer will be billed every ${newPlanIntervalCount} ${newPlanInterval.toLowerCase()}(s)`}
            />
            <TextField
              label="Discount Percentage"
              type="number"
              value={newPlanDiscount}
              onChange={setNewPlanDiscount}
              min={0}
              max={100}
              suffix="%"
              autoComplete="off"
              helpText="Percentage discount applied to subscription orders"
            />
            <Banner tone="info">
              Preview: {newPlanName || `Deliver ${formatFrequency(newPlanInterval, parseInt(newPlanIntervalCount, 10) || 1)} (${newPlanDiscount}% off)`}
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete Confirmation Modal (Shopify Selling Plans) */}
      <Modal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Subscription Plan"
        primaryAction={{
          content: "Delete Plan",
          destructive: true,
          onAction: confirmDeletePlan,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteConfirmOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Are you sure you want to delete the plan <strong>"{planToDelete?.name}"</strong>?
            </Text>
            <Banner tone="warning">
              Existing subscribers on this plan may be affected. Make sure to migrate them to a different plan first.
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Plan Group Create/Edit Modal */}
      <Modal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        title={editingGroup ? "Edit Plan Group" : "Add Plan Group"}
        primaryAction={{
          content: editingGroup ? "Save Changes" : "Create Group",
          onAction: handleSaveGroup,
          loading: isLoading,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setGroupModalOpen(false),
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Plan Group Name"
              value={groupName}
              onChange={setGroupName}
              placeholder="e.g., Subscribe & Save - Porch Pick Up"
              autoComplete="off"
            />
            <TextField
              label="Billing Lead Time (hours)"
              type="number"
              value={groupBillingLeadHours}
              onChange={setGroupBillingLeadHours}
              min={1}
              max={168}
              suffix="hours"
              autoComplete="off"
              helpText="How many hours before pickup to charge customers in this plan group"
            />
            <Select
              label="Status"
              options={[
                { label: "Active", value: "true" },
                { label: "Inactive", value: "false" },
              ]}
              value={groupIsActive ? "true" : "false"}
              onChange={(val) => setGroupIsActive(val === "true")}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Frequency Create/Edit Modal */}
      <Modal
        open={freqModalOpen}
        onClose={() => setFreqModalOpen(false)}
        title={editingFreq ? "Edit Frequency" : "Add Frequency"}
        primaryAction={{
          content: editingFreq ? "Save Changes" : "Add Frequency",
          onAction: handleSaveFreq,
          loading: isLoading,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setFreqModalOpen(false),
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Frequency Name"
              value={freqName}
              onChange={setFreqName}
              placeholder="e.g., Weekly Delivery (10% off)"
              autoComplete="off"
            />
            <FormLayout.Group>
              <Select
                label="Delivery Interval"
                options={[
                  { label: "Week(s)", value: "WEEK" },
                  { label: "Month(s)", value: "MONTH" },
                ]}
                value={freqInterval}
                onChange={setFreqInterval}
              />
              <TextField
                label="Every X intervals"
                type="number"
                value={freqIntervalCount}
                onChange={setFreqIntervalCount}
                min={1}
                max={52}
                autoComplete="off"
                helpText={`Deliver every ${freqIntervalCount} ${freqInterval.toLowerCase()}(s)`}
              />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField
                label="Discount Percentage"
                type="number"
                value={freqDiscount}
                onChange={setFreqDiscount}
                min={0}
                max={100}
                suffix="%"
                autoComplete="off"
              />
              <TextField
                label="Discount Code (auto-generated if blank)"
                value={freqDiscountCode}
                onChange={setFreqDiscountCode}
                placeholder="e.g., SUBSCRIBE-WEEKLY-10"
                autoComplete="off"
                helpText="Leave blank to auto-generate. SSMA will create the discount code in Shopify automatically."
              />
            </FormLayout.Group>
            <Select
              label="Status"
              options={[
                { label: "Active", value: "true" },
                { label: "Inactive", value: "false" },
              ]}
              value={freqIsActive ? "true" : "false"}
              onChange={(val) => setFreqIsActive(val === "true")}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete Plan Group Confirmation */}
      <Modal
        open={deleteGroupConfirmOpen}
        onClose={() => setDeleteGroupConfirmOpen(false)}
        title="Delete Plan Group"
        primaryAction={{
          content: "Delete Group",
          destructive: true,
          onAction: confirmDeleteGroup,
          loading: isLoading,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setDeleteGroupConfirmOpen(false),
        }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Are you sure you want to delete <strong>"{groupToDelete?.name}"</strong>?
            </Text>
            <Banner tone="warning">
              This will also delete all frequency options and product associations in this group. Existing subscribers will not be affected.
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete Frequency Confirmation */}
      <Modal
        open={deleteFreqConfirmOpen}
        onClose={() => setDeleteFreqConfirmOpen(false)}
        title="Delete Frequency"
        primaryAction={{
          content: "Delete Frequency",
          destructive: true,
          onAction: confirmDeleteFreq,
          loading: isLoading,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setDeleteFreqConfirmOpen(false),
        }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Are you sure you want to delete <strong>"{freqToDelete?.name}"</strong>?
            </Text>
            <Banner tone="warning">
              New customers will no longer see this frequency option. Existing subscribers are not affected.
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
