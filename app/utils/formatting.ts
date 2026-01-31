/**
 * Shared Formatting Utilities
 * Can be used on both client and server
 */

import type { ContractDeliveryPolicy } from "../types/subscription-contracts";

// ============================================
// Selling Plan Formatting
// ============================================

/**
 * Format selling plan frequency label
 */
export function formatFrequency(interval: string, intervalCount: number): string {
  if (interval === "WEEK") {
    if (intervalCount === 1) return "Weekly";
    if (intervalCount === 2) return "Every 2 weeks";
    return `Every ${intervalCount} weeks`;
  }
  if (interval === "MONTH") {
    if (intervalCount === 1) return "Monthly";
    return `Every ${intervalCount} months`;
  }
  if (interval === "DAY") {
    if (intervalCount === 1) return "Daily";
    return `Every ${intervalCount} days`;
  }
  return `Every ${intervalCount} ${interval.toLowerCase()}s`;
}

// ============================================
// Currency Formatting
// ============================================

/**
 * Format currency amount for display
 */
export function formatCurrency(amount: string, currencyCode: string = "USD"): string {
  const numAmount = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(numAmount);
}

/**
 * Get delivery frequency label
 */
export function getDeliveryFrequencyLabel(deliveryPolicy: ContractDeliveryPolicy | null): string {
  if (!deliveryPolicy) return "Unknown";

  const { interval, intervalCount } = deliveryPolicy;

  if (interval === "WEEK") {
    if (intervalCount === 1) return "Every week";
    if (intervalCount === 2) return "Every 2 weeks";
    if (intervalCount === 3) return "Every 3 weeks";
    return `Every ${intervalCount} weeks`;
  }

  if (interval === "MONTH") {
    if (intervalCount === 1) return "Every month";
    return `Every ${intervalCount} months`;
  }

  if (interval === "DAY") {
    if (intervalCount === 1) return "Every day";
    return `Every ${intervalCount} days`;
  }

  return `Every ${intervalCount} ${interval.toLowerCase()}s`;
}

/**
 * Get line items summary for display in list view
 */
export function getLineItemsSummary(lines: { title: string; quantity: number }[]): string {
  if (lines.length === 0) return "No products";
  if (lines.length === 1) {
    const line = lines[0];
    return line.quantity > 1
      ? `${line.title} (x${line.quantity})`
      : line.title;
  }
  return `${lines.length} products`;
}

/**
 * Format payment method for display
 */
export function formatPaymentMethod(paymentMethod: {
  instrument?: {
    brand?: string | null;
    lastDigits?: string | null;
    walletType?: string | null;
  } | null;
} | null): string {
  if (!paymentMethod || !paymentMethod.instrument) {
    return "No payment method";
  }

  const instrument = paymentMethod.instrument;

  if (instrument.walletType === "PAYPAL") {
    return "PayPal";
  }

  if (instrument.brand && instrument.lastDigits) {
    const brand =
      instrument.brand.charAt(0).toUpperCase() +
      instrument.brand.slice(1).toLowerCase();
    return `${brand} •••• ${instrument.lastDigits}`;
  }

  if (instrument.lastDigits) {
    return `•••• ${instrument.lastDigits}`;
  }

  return "Payment method on file";
}

/**
 * Format payment method expiry for display
 */
export function formatPaymentExpiry(paymentMethod: {
  instrument?: {
    expiryMonth?: number | null;
    expiryYear?: number | null;
  } | null;
} | null): string | null {
  if (!paymentMethod?.instrument?.expiryMonth || !paymentMethod?.instrument?.expiryYear) {
    return null;
  }

  const month = paymentMethod.instrument.expiryMonth.toString().padStart(2, "0");
  const year = paymentMethod.instrument.expiryYear.toString().slice(-2);
  return `${month}/${year}`;
}
