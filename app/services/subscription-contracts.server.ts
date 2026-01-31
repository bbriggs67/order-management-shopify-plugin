/**
 * Subscription Contracts Service
 * Fetches detailed subscription contract information from Shopify
 */

// Type for the admin GraphQL client returned by authenticate.admin()
interface AdminClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

// ============================================
// Types
// ============================================

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
    // For Shop Pay or other digital wallets
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
  // Note: Shopify doesn't provide a built-in pricing summary on contracts
  // We'll calculate from line items
}

export interface ContractWithPricing extends ShopifyContractDetails {
  pricingSummary: ContractPricingSummary;
}

// ============================================
// GraphQL Queries
// ============================================

const SUBSCRIPTION_CONTRACT_DETAILS_QUERY = `
  query getSubscriptionContractDetails($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      createdAt
      nextBillingDate
      customer {
        id
        email
        displayName
      }
      customerPaymentMethod {
        id
        instrument {
          ... on CustomerCreditCard {
            brand
            lastDigits
            expiryMonth
            expiryYear
            name
          }
          ... on CustomerShopPayAgreement {
            lastDigits
            expiryMonth
            expiryYear
            name
          }
          ... on CustomerPaypalBillingAgreement {
            paypalAccountEmail
          }
        }
      }
      lines(first: 50) {
        edges {
          node {
            id
            title
            variantTitle
            quantity
            currentPrice {
              amount
              currencyCode
            }
            productId
            variantId
            variantImage {
              url
              altText
            }
          }
        }
      }
      deliveryPolicy {
        interval
        intervalCount
      }
    }
  }
`;

const SUBSCRIPTION_CONTRACTS_LIST_QUERY = `
  query getSubscriptionContractsList($first: Int!, $query: String) {
    subscriptionContracts(first: $first, query: $query) {
      edges {
        node {
          id
          status
          customer {
            id
            email
            displayName
          }
          lines(first: 10) {
            edges {
              node {
                id
                title
                variantTitle
                quantity
                currentPrice {
                  amount
                  currencyCode
                }
                variantImage {
                  url
                  altText
                }
              }
            }
          }
          deliveryPolicy {
            interval
            intervalCount
          }
          nextBillingDate
        }
      }
    }
  }
`;

// ============================================
// Service Functions
// ============================================

/**
 * Get detailed subscription contract information from Shopify
 */
export async function getContractDetails(
  admin: AdminClient,
  contractId: string
): Promise<ContractWithPricing | null> {
  try {
    const response = await admin.graphql(SUBSCRIPTION_CONTRACT_DETAILS_QUERY, {
      variables: { id: contractId },
    });

    const jsonResponse = await response.json();
    const data = jsonResponse.data;

    if (!data?.subscriptionContract) {
      console.log(`Contract not found: ${contractId}`);
      return null;
    }

    const contract = data.subscriptionContract;

    // Parse line items
    const lines: ContractLineItem[] = contract.lines.edges.map((edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      variantTitle: edge.node.variantTitle,
      quantity: edge.node.quantity,
      currentPrice: edge.node.currentPrice,
      productId: edge.node.productId,
      variantId: edge.node.variantId,
      variantImage: edge.node.variantImage,
    }));

    // Parse payment method
    let customerPaymentMethod: ContractPaymentMethod | null = null;
    if (contract.customerPaymentMethod) {
      const instrument = contract.customerPaymentMethod.instrument;
      customerPaymentMethod = {
        id: contract.customerPaymentMethod.id,
        instrument: instrument ? {
          brand: instrument.brand || null,
          lastDigits: instrument.lastDigits || null,
          expiryMonth: instrument.expiryMonth || null,
          expiryYear: instrument.expiryYear || null,
          name: instrument.name || null,
          walletType: instrument.paypalAccountEmail ? 'PAYPAL' : null,
        } : null,
      };
    }

    // Calculate pricing summary from line items
    const pricingSummary = calculatePricingSummary(lines);

    return {
      id: contract.id,
      status: contract.status,
      createdAt: contract.createdAt,
      nextBillingDate: contract.nextBillingDate,
      customer: contract.customer,
      customerPaymentMethod,
      lines,
      deliveryPolicy: contract.deliveryPolicy,
      pricingSummary,
    };
  } catch (error) {
    console.error(`Error fetching contract details for ${contractId}:`, error);
    return null;
  }
}

/**
 * Get multiple subscription contracts with basic details
 */
export async function getContractsWithDetails(
  admin: AdminClient,
  contractIds: string[]
): Promise<Map<string, ShopifyContractDetails>> {
  const results = new Map<string, ShopifyContractDetails>();

  // Fetch contracts in parallel (batch of 10)
  const batches = [];
  for (let i = 0; i < contractIds.length; i += 10) {
    batches.push(contractIds.slice(i, i + 10));
  }

  for (const batch of batches) {
    const promises = batch.map((id) => getContractDetails(admin, id));
    const batchResults = await Promise.all(promises);

    batchResults.forEach((result, index) => {
      if (result) {
        results.set(batch[index], result);
      }
    });
  }

  return results;
}

/**
 * Get line items summary for display in list view
 */
export function getLineItemsSummary(lines: ContractLineItem[]): string {
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
 * Calculate total price from line items
 */
export function calculatePricingSummary(lines: ContractLineItem[]): ContractPricingSummary {
  const currencyCode = lines[0]?.currentPrice?.currencyCode || "USD";

  let subtotal = 0;
  for (const line of lines) {
    const price = parseFloat(line.currentPrice.amount);
    subtotal += price * line.quantity;
  }

  // Note: We don't have tax info from the contract lines
  // In a real implementation, you might need to fetch this from orders
  // or use the store's tax settings
  const totalTax = 0;
  const totalPrice = subtotal + totalTax;

  return {
    subtotalPrice: {
      amount: subtotal.toFixed(2),
      currencyCode,
    },
    totalTax: {
      amount: totalTax.toFixed(2),
      currencyCode,
    },
    totalPrice: {
      amount: totalPrice.toFixed(2),
      currencyCode,
    },
  };
}

/**
 * Format payment method for display
 */
export function formatPaymentMethod(paymentMethod: ContractPaymentMethod | null): string {
  if (!paymentMethod || !paymentMethod.instrument) {
    return "No payment method";
  }

  const instrument = paymentMethod.instrument;

  if (instrument.walletType === 'PAYPAL') {
    return "PayPal";
  }

  if (instrument.brand && instrument.lastDigits) {
    const brand = instrument.brand.charAt(0).toUpperCase() + instrument.brand.slice(1).toLowerCase();
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
export function formatPaymentExpiry(paymentMethod: ContractPaymentMethod | null): string | null {
  if (!paymentMethod?.instrument?.expiryMonth || !paymentMethod?.instrument?.expiryYear) {
    return null;
  }

  const month = paymentMethod.instrument.expiryMonth.toString().padStart(2, '0');
  const year = paymentMethod.instrument.expiryYear.toString().slice(-2);
  return `${month}/${year}`;
}

/**
 * Format currency amount for display
 */
export function formatCurrency(amount: string, currencyCode: string = "USD"): string {
  const numAmount = parseFloat(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
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
