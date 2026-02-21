/**
 * Subscription Contract Types
 * Shared types for both server and client use
 */

export interface ContractLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  currentPrice: {
    amount: string;
    currencyCode: string;
  };
  productId: string | null;
  variantId: string | null;
  variantImage: {
    url: string;
    altText: string | null;
  } | null;
}

export interface ContractPaymentMethod {
  id: string;
  instrument: {
    brand: string | null;
    lastDigits: string | null;
    expiryMonth: number | null;
    expiryYear: number | null;
    name: string | null;
    walletType: string | null;
  } | null;
}

export interface ContractPricingSummary {
  subtotalPrice: {
    amount: string;
    currencyCode: string;
  };
  totalTax: {
    amount: string;
    currencyCode: string;
  };
  totalPrice: {
    amount: string;
    currencyCode: string;
  };
}

export interface ContractDeliveryPolicy {
  interval: string;
  intervalCount: number;
}

export interface ShopifyContractDetails {
  id: string;
  status: string;
  createdAt: string;
  nextBillingDate: string | null;
  customer: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  customerPaymentMethod: ContractPaymentMethod | null;
  lines: ContractLineItem[];
  deliveryPolicy: ContractDeliveryPolicy | null;
}

export interface ContractWithPricing extends ShopifyContractDetails {
  pricingSummary: ContractPricingSummary;
}
