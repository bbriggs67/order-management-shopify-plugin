/**
 * Draft Orders Service
 * Creates Shopify draft orders from the CRM and sends payment links.
 */

import { sendSMS } from "./notifications.server";
import type {
  DraftOrderCreateInput,
  DraftOrderResult,
} from "../types/customer-crm";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
};

// ============================================
// CREATE DRAFT ORDER
// ============================================

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        totalPriceSet {
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
`;

export async function createDraftOrder(
  admin: AdminClient,
  input: DraftOrderCreateInput
): Promise<DraftOrderResult> {
  const draftOrderInput: Record<string, unknown> = {
    customerId: input.customerId,
    lineItems: input.lineItems.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
    })),
    useCustomerDefaultAddress: true,
  };

  if (input.note) {
    draftOrderInput.note = input.note;
  }

  if (input.tags && input.tags.length > 0) {
    draftOrderInput.tags = input.tags;
  }

  const response = await admin.graphql(DRAFT_ORDER_CREATE_MUTATION, {
    variables: { input: draftOrderInput },
  });

  const result = await response.json();
  const data = (result as any)?.data?.draftOrderCreate;

  if (data?.userErrors?.length > 0) {
    const errorMsg = data.userErrors
      .map((e: { field: string[]; message: string }) => e.message)
      .join(", ");
    throw new Error(`Draft order creation failed: ${errorMsg}`);
  }

  const draftOrder = data?.draftOrder;
  if (!draftOrder) {
    throw new Error("Draft order creation returned no data");
  }

  return {
    id: draftOrder.id,
    name: draftOrder.name,
    invoiceUrl: draftOrder.invoiceUrl,
    totalPrice: draftOrder.totalPriceSet?.shopMoney?.amount || "0.00",
    currencyCode: draftOrder.totalPriceSet?.shopMoney?.currencyCode || "USD",
  };
}

// ============================================
// SEND SHOPIFY INVOICE EMAIL
// ============================================

const DRAFT_ORDER_INVOICE_SEND = `
  mutation draftOrderInvoiceSend($id: ID!) {
    draftOrderInvoiceSend(id: $id) {
      draftOrder {
        id
        name
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function sendDraftOrderInvoice(
  admin: AdminClient,
  draftOrderId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await admin.graphql(DRAFT_ORDER_INVOICE_SEND, {
      variables: { id: draftOrderId },
    });

    const result = await response.json();
    const data = (result as any)?.data?.draftOrderInvoiceSend;

    if (data?.userErrors?.length > 0) {
      const errorMsg = data.userErrors
        .map((e: { field: string[]; message: string }) => e.message)
        .join(", ");
      return { success: false, error: errorMsg };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================
// SEND PAYMENT LINK VIA SMS
// ============================================

export async function sendPaymentLinkViaSMS(
  phone: string,
  customerName: string,
  invoiceUrl: string,
  orderName: string
): Promise<{ success: boolean; error?: string }> {
  const firstName = customerName.split(" ")[0] || customerName;
  const message =
    `Hi ${firstName}! Your order ${orderName} from Susie's Sourdough is ready for payment. ` +
    `Complete your order here: ${invoiceUrl}`;

  return sendSMS(phone, message);
}
