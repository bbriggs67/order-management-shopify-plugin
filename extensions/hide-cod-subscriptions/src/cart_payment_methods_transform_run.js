// @ts-check

/**
 * Hide COD for Subscriptions - Payment Customization Function
 *
 * This Shopify Function hides the Cash on Delivery (COD) payment method
 * when the cart contains items with a selling plan (subscription items).
 *
 * Subscriptions require payment methods that can be charged automatically
 * for recurring billing, so COD is not compatible.
 */

/**
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunInput} CartPaymentMethodsTransformRunInput
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunResult} CartPaymentMethodsTransformRunResult
 */

/**
 * @type {CartPaymentMethodsTransformRunResult}
 */
const NO_CHANGES = {
  operations: [],
};

/**
 * @param {CartPaymentMethodsTransformRunInput} input
 * @returns {CartPaymentMethodsTransformRunResult}
 */
export function cartPaymentMethodsTransformRun(input) {
  // Check if any cart line has a selling plan (subscription)
  const hasSubscriptionItem = input.cart?.lines?.some(
    (line) => line.sellingPlanAllocation !== null
  );

  // If no subscription items, don't hide any payment methods
  if (!hasSubscriptionItem) {
    return NO_CHANGES;
  }

  // Find COD payment methods to hide
  // Common names: "Cash on Delivery", "COD", "Cash on Delivery (COD)"
  const paymentMethods = input.paymentMethods || [];
  const codPaymentMethods = paymentMethods.filter((method) => {
    const nameLower = (method.name || '').toLowerCase();
    return (
      nameLower.includes("cash on delivery") ||
      nameLower.includes("cod") ||
      nameLower.includes("pay on delivery") ||
      nameLower.includes("collect on delivery")
    );
  });

  // If no COD payment methods found, return no changes
  if (codPaymentMethods.length === 0) {
    return NO_CHANGES;
  }

  // Create hide operations for each COD payment method
  const operations = codPaymentMethods.map((method) => ({
    hide: {
      paymentMethodId: method.id,
    },
  }));

  return { operations };
}
