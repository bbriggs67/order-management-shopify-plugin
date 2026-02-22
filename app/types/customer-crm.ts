/**
 * CRM Types — Customer Relationship Management Portal
 */

// ============================================
// LIST VIEW TYPES
// ============================================

export interface CustomerListItem {
  id: string;
  shopifyCustomerId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  activeSubscriptionCount: number;
  lastOrderDate: string | null;
}

// ============================================
// DETAIL VIEW TYPES
// ============================================

export interface CustomerDetail extends CustomerListItem {
  // Live stats from Shopify API
  totalOrderCount: number;
  totalSpent: string | null;
  currency: string;

  // From Shopify API enrichment
  shopifyNote: string | null;
  shopifyTags: string[];
  defaultAddress: ShopifyAddress | null;
  addresses: ShopifyAddress[];
  memberSince: string | null;

  // From local DB
  notes: CustomerNoteData[];
  orders: CustomerOrderSummary[];
  subscriptions: CustomerSubscriptionSummary[];
}

export interface ShopifyAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
}

export interface CustomerNoteData {
  id: string;
  content: string;
  category: string | null;
  isPinned: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrderSummary {
  id: string;
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  pickupDate: string;
  pickupTimeSlot: string;
  pickupStatus: string;
  isSubscription: boolean;
  subscriptionContractId: string | null;
  items: Array<{
    productTitle: string;
    variantTitle: string | null;
    quantity: number;
  }>;
  createdAt: string;
}

export interface CustomerSubscriptionSummary {
  id: string;
  shopifyContractId: string;
  frequency: string;
  status: string;
  preferredDay: number;
  preferredTimeSlot: string;
  nextPickupDate: string | null;
  discountPercent: number;
  adminNotes: string | null;
}

// ============================================
// NOTE CATEGORIES
// ============================================

export const NOTE_CATEGORIES = [
  { label: "General", value: "general" },
  { label: "Product Preference", value: "preference" },
  { label: "Family Info", value: "family" },
  { label: "Allergy/Dietary", value: "allergy" },
  { label: "Delivery Notes", value: "delivery" },
] as const;

export type NoteCategory = typeof NOTE_CATEGORIES[number]["value"];

// ============================================
// DRAFT ORDER TYPES (Phase 4 — placeholder)
// ============================================

export interface DraftOrderCreateInput {
  customerId: string;
  lineItems: DraftOrderLineItem[];
  note?: string;
  tags?: string[];
}

export interface DraftOrderLineItem {
  variantId: string;
  quantity: number;
}

export interface DraftOrderResult {
  id: string;
  name: string;
  invoiceUrl: string;
  totalPrice: string;
  currencyCode: string;
}

// ============================================
// SMS CONVERSATION
// ============================================

export interface SmsMessageData {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: string;
  createdAt: string;
}
