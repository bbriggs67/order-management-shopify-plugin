/**
 * Order Management Service
 * Handles order cancellation and refunds via Shopify Admin API
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// Cancellation reasons matching Shopify's options
export const CANCELLATION_REASONS = [
  { value: "CUSTOMER", label: "Customer changed or canceled order" },
  { value: "FRAUD", label: "Fraudulent order" },
  { value: "INVENTORY", label: "Items unavailable" },
  { value: "DECLINED", label: "Payment declined" },
  { value: "OTHER", label: "Other" },
] as const;

export type CancellationReason = typeof CANCELLATION_REASONS[number]["value"];

interface CancelOrderOptions {
  orderId: string; // Shopify GID like "gid://shopify/Order/123456"
  reason: CancellationReason;
  staffNote?: string;
  restockInventory: boolean;
  notifyCustomer: boolean;
}

interface CancelOrderResult {
  success: boolean;
  refundId?: string;
  refundAmount?: string;
  currencyCode?: string;
  error?: string;
}

interface OrderForRefund {
  id: string;
  name: string;
  cancelledAt: string | null;
  fullyPaid: boolean;
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  totalRefundedSet: {
    shopMoney: {
      amount: string;
    };
  };
  transactions: Array<{
    id: string;
    kind: string;
    status: string;
    amountSet: {
      shopMoney: {
        amount: string;
        currencyCode: string;
      };
    };
    gateway: string;
  }>;
  lineItems: {
    nodes: Array<{
      id: string;
      quantity: number;
      refundableQuantity: number;
    }>;
  };
}

/**
 * Get order details needed for refund calculation
 */
export async function getOrderForRefund(
  admin: AdminApiContext,
  orderId: string
): Promise<OrderForRefund | null> {
  const response = await admin.graphql(`
    query getOrderForRefund($id: ID!) {
      order(id: $id) {
        id
        name
        cancelledAt
        fullyPaid
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
          }
        }
        transactions(first: 10) {
          id
          kind
          status
          amountSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          gateway
        }
        lineItems(first: 50) {
          nodes {
            id
            quantity
            refundableQuantity
          }
        }
      }
    }
  `, {
    variables: { id: orderId },
  });

  const data = await response.json();
  return data.data?.order || null;
}

/**
 * Cancel an order and issue a full refund
 */
export async function cancelOrderWithRefund(
  admin: AdminApiContext,
  options: CancelOrderOptions
): Promise<CancelOrderResult> {
  const { orderId, reason, staffNote, restockInventory, notifyCustomer } = options;

  try {
    // First, get the order details to understand what we're refunding
    const order = await getOrderForRefund(admin, orderId);

    if (!order) {
      return { success: false, error: "Order not found" };
    }

    if (order.cancelledAt) {
      return { success: false, error: "Order is already cancelled" };
    }

    // Calculate refund amount (total price minus already refunded)
    const totalPrice = parseFloat(order.totalPriceSet.shopMoney.amount);
    const totalRefunded = parseFloat(order.totalRefundedSet.shopMoney.amount);
    const refundAmount = totalPrice - totalRefunded;

    if (refundAmount <= 0) {
      // No refund needed, just cancel the order
      return await cancelOrderOnly(admin, orderId, reason, staffNote, notifyCustomer);
    }

    // Find the parent transaction to refund against
    const parentTransaction = order.transactions.find(
      (t) => t.kind === "SALE" && t.status === "SUCCESS"
    ) || order.transactions.find(
      (t) => t.kind === "CAPTURE" && t.status === "SUCCESS"
    ) || order.transactions.find(
      (t) => t.kind === "AUTHORIZATION" && t.status === "SUCCESS"
    );

    if (!parentTransaction) {
      // No transaction to refund - might be unpaid, just cancel
      return await cancelOrderOnly(admin, orderId, reason, staffNote, notifyCustomer);
    }

    // Build refund line items if restocking
    const refundLineItems = restockInventory
      ? order.lineItems.nodes
          .filter((item) => item.refundableQuantity > 0)
          .map((item) => ({
            lineItemId: item.id,
            quantity: item.refundableQuantity,
            restockType: "RETURN" as const,
          }))
      : [];

    // Create the refund
    const refundResponse = await admin.graphql(`
      mutation refundCreate($input: RefundInput!) {
        refundCreate(input: $input) {
          refund {
            id
            totalRefundedSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        input: {
          orderId,
          note: staffNote || `Cancelled: ${reason}`,
          notify: notifyCustomer,
          refundLineItems: refundLineItems.length > 0 ? refundLineItems : undefined,
          transactions: [
            {
              parentId: parentTransaction.id,
              amount: refundAmount.toFixed(2),
              kind: "REFUND",
              gateway: parentTransaction.gateway,
            },
          ],
        },
      },
    });

    const refundData = await refundResponse.json();

    if (refundData.data?.refundCreate?.userErrors?.length > 0) {
      const errors = refundData.data.refundCreate.userErrors;
      console.error("Refund errors:", errors);
      return {
        success: false,
        error: errors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    const refund = refundData.data?.refundCreate?.refund;

    // Now cancel the order
    const cancelResult = await cancelOrderOnly(admin, orderId, reason, staffNote, notifyCustomer);

    if (!cancelResult.success) {
      // Refund succeeded but cancel failed - still return partial success
      console.error("Order cancel failed after refund:", cancelResult.error);
    }

    return {
      success: true,
      refundId: refund?.id,
      refundAmount: refund?.totalRefundedSet?.shopMoney?.amount || refundAmount.toFixed(2),
      currencyCode: order.totalPriceSet.shopMoney.currencyCode,
    };
  } catch (error) {
    console.error("Error cancelling order with refund:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Cancel an order without refund (for unpaid orders or when refund is separate)
 */
async function cancelOrderOnly(
  admin: AdminApiContext,
  orderId: string,
  reason: CancellationReason,
  staffNote?: string,
  notifyCustomer?: boolean
): Promise<CancelOrderResult> {
  try {
    const response = await admin.graphql(`
      mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $notifyCustomer: Boolean, $staffNote: String) {
        orderCancel(orderId: $orderId, reason: $reason, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
          job {
            id
          }
          orderCancelUserErrors {
            field
            message
            code
          }
        }
      }
    `, {
      variables: {
        orderId,
        reason,
        notifyCustomer: notifyCustomer ?? false,
        staffNote: staffNote || undefined,
      },
    });

    const data = await response.json();

    if (data.data?.orderCancel?.orderCancelUserErrors?.length > 0) {
      const errors = data.data.orderCancel.orderCancelUserErrors;
      console.error("Order cancel errors:", errors);
      return {
        success: false,
        error: errors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Error cancelling order:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Get refundable amount for an order
 */
export async function getRefundableAmount(
  admin: AdminApiContext,
  orderId: string
): Promise<{ amount: string; currencyCode: string } | null> {
  const order = await getOrderForRefund(admin, orderId);

  if (!order) return null;

  const totalPrice = parseFloat(order.totalPriceSet.shopMoney.amount);
  const totalRefunded = parseFloat(order.totalRefundedSet.shopMoney.amount);
  const refundable = Math.max(0, totalPrice - totalRefunded);

  return {
    amount: refundable.toFixed(2),
    currencyCode: order.totalPriceSet.shopMoney.currencyCode,
  };
}
