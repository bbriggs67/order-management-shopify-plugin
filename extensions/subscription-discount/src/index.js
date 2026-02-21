/**
 * Shopify Discount Function: Subscription Discount
 *
 * Reads cart attributes set by the SSMA cart page widget:
 *   - "Subscription Enabled" = "true" → discount is active
 *   - "Subscription Discount" = percentage number (e.g. "10", "5")
 *
 * Applies a percentage discount to all cart lines when both attributes are present.
 * This replaces the old code-based discount system (SUBSCRIBE-WEEKLY-10, etc.)
 * and eliminates the discount code input field from checkout.
 *
 * @param {object} input - The RunInput from Shopify (cart data + attributes)
 * @returns {object} FunctionResult with discount operations
 */

// No-op result
const EMPTY = { operations: [] };

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  // Check if this discount supports the PRODUCT discount class
  const hasProductDiscountClass =
    input.discount.discountClasses.includes("PRODUCT");

  if (!hasProductDiscountClass) {
    return EMPTY;
  }

  // Check if subscription is enabled via cart attribute
  const subscriptionEnabled = input.cart.subscriptionEnabled?.value;
  if (subscriptionEnabled !== "true") {
    return EMPTY;
  }

  // Parse the discount percentage from cart attributes
  const discountPercentRaw = input.cart.subscriptionDiscount?.value;
  const discountPercent = parseFloat(discountPercentRaw || "0");

  // Validate the discount percentage
  if (!discountPercent || discountPercent <= 0 || discountPercent > 100) {
    return EMPTY;
  }

  // Build targets for all cart lines
  const targets = input.cart.lines.map((line) => ({
    cartLine: { id: line.id },
  }));

  if (targets.length === 0) {
    return EMPTY;
  }

  // Return the discount operation
  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "Subscription: " + discountPercent + "% off",
              targets,
              value: {
                percentage: {
                  value: discountPercent,
                },
              },
            },
          ],
          selectionStrategy: "FIRST",
        },
      },
    ],
  };
}
