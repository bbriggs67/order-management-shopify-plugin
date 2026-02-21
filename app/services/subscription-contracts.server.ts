/**
 * Subscription Contracts Service
 * Fetches detailed subscription contract information from Shopify
 */

// Re-export types from shared types file for consumers
export type {
  ContractLineItem,
  ContractPaymentMethod,
  ContractPricingSummary,
  ContractDeliveryPolicy,
  ShopifyContractDetails,
  ContractWithPricing,
} from "../types/subscription-contracts";

// Import types for internal use
import type {
  ContractLineItem,
  ContractPaymentMethod,
  ContractPricingSummary,
  ContractDeliveryPolicy,
  ShopifyContractDetails,
  ContractWithPricing,
} from "../types/subscription-contracts";

// Type for the admin GraphQL client returned by authenticate.admin()
interface AdminClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
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

// Batch query for multiple contracts - avoids N+1 problem
const SUBSCRIPTION_CONTRACTS_BATCH_QUERY = `
  query getSubscriptionContractsBatch($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on SubscriptionContract {
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
 * @deprecated Use getContractDetailsBatch instead for better performance
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
 * Batch fetch multiple contract details in a single GraphQL query
 * Solves N+1 query problem - use this for list views
 *
 * @param admin - Shopify admin client
 * @param contractIds - Array of Shopify contract GIDs
 * @returns Map of contract ID to contract details with pricing
 */
export async function getContractDetailsBatch(
  admin: AdminClient,
  contractIds: string[]
): Promise<Map<string, ContractWithPricing>> {
  const results = new Map<string, ContractWithPricing>();

  if (contractIds.length === 0) {
    return results;
  }

  // Shopify nodes query supports up to 250 IDs, but we'll batch at 50 for safety
  const BATCH_SIZE = 50;
  const batches: string[][] = [];

  for (let i = 0; i < contractIds.length; i += BATCH_SIZE) {
    batches.push(contractIds.slice(i, i + BATCH_SIZE));
  }

  for (const batchIds of batches) {
    try {
      const response = await admin.graphql(SUBSCRIPTION_CONTRACTS_BATCH_QUERY, {
        variables: { ids: batchIds },
      });

      const jsonResponse = await response.json();
      const nodes = jsonResponse.data?.nodes || [];

      for (const contract of nodes) {
        if (!contract || !contract.id) continue;

        // Parse line items
        const lines: ContractLineItem[] = (contract.lines?.edges || []).map((edge: any) => ({
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
            instrument: instrument
              ? {
                  brand: instrument.brand || null,
                  lastDigits: instrument.lastDigits || null,
                  expiryMonth: instrument.expiryMonth || null,
                  expiryYear: instrument.expiryYear || null,
                  name: instrument.name || null,
                  walletType: instrument.paypalAccountEmail ? "PAYPAL" : null,
                }
              : null,
          };
        }

        // Calculate pricing summary
        const pricingSummary = calculatePricingSummary(lines);

        results.set(contract.id, {
          id: contract.id,
          status: contract.status,
          createdAt: contract.createdAt,
          nextBillingDate: contract.nextBillingDate,
          customer: contract.customer,
          customerPaymentMethod,
          lines,
          deliveryPolicy: contract.deliveryPolicy,
          pricingSummary,
        });
      }
    } catch (error) {
      console.error(`Error fetching batch of contracts:`, error);
      // Continue with other batches even if one fails
    }
  }

  return results;
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

// Re-export formatting utilities from shared file for backward compatibility
export {
  formatCurrency,
  getDeliveryFrequencyLabel,
  formatPaymentMethod,
  formatPaymentExpiry,
  getLineItemsSummary,
} from "../utils/formatting";
