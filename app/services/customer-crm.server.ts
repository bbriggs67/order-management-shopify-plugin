/**
 * Customer CRM Service
 * Core business logic for the Customer Relationship Management portal.
 * Handles customer search, detail enrichment, note CRUD, and Shopify sync.
 */

import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { normalizePhone } from "../utils/phone.server";
import type {
  CustomerListItem,
  CustomerDetail,
  CustomerNoteData,
  CustomerOrderSummary,
  CustomerSubscriptionSummary,
  ShopifyAddress,
} from "../types/customer-crm";

const ITEMS_PER_PAGE = 50;

// ============================================
// SORT/FILTER VALIDATION
// ============================================

const SORT_FIELD_MAP: Record<string, string> = {
  name: "lastName",
  email: "email",
};

const VALID_SORT_FIELDS = Object.keys(SORT_FIELD_MAP);
const VALID_DIRECTIONS = ["asc", "desc"] as const;

// ============================================
// CUSTOMER SEARCH (LIST PAGE)
// ============================================

export interface SearchCustomersOptions {
  search?: string;
  filter?: string; // "subscribed" | "recent" | "inactive"
  cursor?: string;
  limit?: number;
  sort?: string;
  direction?: string;
}

export async function searchCustomers(
  shop: string,
  options: SearchCustomersOptions = {}
): Promise<{
  customers: CustomerListItem[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;
}> {
  const limit = options.limit || ITEMS_PER_PAGE;
  const sort = VALID_SORT_FIELDS.includes(options.sort || "")
    ? options.sort!
    : "name";
  const direction = VALID_DIRECTIONS.includes(
    (options.direction || "") as (typeof VALID_DIRECTIONS)[number]
  )
    ? (options.direction as "asc" | "desc")
    : "asc";

  // Build where clause
  const where: Prisma.CustomerWhereInput = { shop };

  if (options.search && options.search.length <= 100) {
    const searchTerm = options.search.trim();
    where.OR = [
      { firstName: { contains: searchTerm, mode: "insensitive" } },
      { lastName: { contains: searchTerm, mode: "insensitive" } },
      { email: { contains: searchTerm, mode: "insensitive" } },
      { phone: { contains: searchTerm, mode: "insensitive" } },
    ];
  }

  // Get total count for display
  const totalCount = await prisma.customer.count({ where });

  // Fetch customers with cursor pagination
  const prismaSort = SORT_FIELD_MAP[sort] || "lastName";
  const customers = await prisma.customer.findMany({
    where,
    orderBy: { [prismaSort]: direction },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = customers.length > limit;
  const results = hasMore ? customers.slice(0, limit) : customers;
  const nextCursor = hasMore ? results[results.length - 1]?.id : null;

  // Enrich with subscription counts
  const customerEmails = results
    .map((c) => c.email)
    .filter((e): e is string => e !== null);

  const subscriptionCounts = await prisma.subscriptionPickup.groupBy({
    by: ["customerEmail"],
    where: {
      shop,
      customerEmail: { in: customerEmails },
      status: "ACTIVE",
    },
    _count: { id: true },
  });

  const subCountMap = new Map(
    subscriptionCounts.map((sc) => [sc.customerEmail, sc._count.id])
  );

  // Get last order dates
  const lastOrderDates = await prisma.pickupSchedule.groupBy({
    by: ["customerEmail"],
    where: {
      shop,
      customerEmail: { in: customerEmails },
    },
    _max: { createdAt: true },
  });

  const lastOrderMap = new Map(
    lastOrderDates.map((lo) => [
      lo.customerEmail,
      lo._max.createdAt?.toISOString() || null,
    ])
  );

  return {
    customers: results.map((c) => ({
      id: c.id,
      shopifyCustomerId: c.shopifyCustomerId,
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      activeSubscriptionCount: c.email
        ? subCountMap.get(c.email) || 0
        : 0,
      lastOrderDate: c.email ? lastOrderMap.get(c.email) || null : null,
    })),
    hasMore,
    nextCursor,
    totalCount,
  };
}

// ============================================
// CUSTOMER DETAIL (DETAIL PAGE)
// ============================================

export async function getCustomerDetail(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shop: string,
  customerId: string
): Promise<CustomerDetail | null> {
  // 1. Fetch local customer record + notes
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shop },
    include: {
      notes: {
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  if (!customer) return null;

  // 2. Fetch Shopify customer data for enrichment
  let shopifyNote: string | null = null;
  let shopifyTags: string[] = [];
  let defaultAddress: ShopifyAddress | null = null;
  let addresses: ShopifyAddress[] = [];
  let memberSince: string | null = null;
  let totalOrderCount = 0;
  let totalSpent: string | null = null;
  let currency = "USD";

  try {
    const response = await admin.graphql(
      `query getCustomerCRM($id: ID!) {
        customer(id: $id) {
          id
          note
          tags
          createdAt
          numberOfOrders
          amountSpent { amount currencyCode }
          defaultAddress {
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          addresses(first: 5) {
            address1
            address2
            city
            province
            zip
            country
            phone
          }
        }
      }`,
      { variables: { id: customer.shopifyCustomerId } }
    );

    const data = await response.json();
    const shopifyCustomer = (data as any)?.data?.customer;
    if (shopifyCustomer) {
      shopifyNote = shopifyCustomer.note || null;
      shopifyTags = shopifyCustomer.tags || [];
      memberSince = shopifyCustomer.createdAt || null;
      totalOrderCount = shopifyCustomer.numberOfOrders || 0;
      totalSpent = shopifyCustomer.amountSpent?.amount || null;
      currency = shopifyCustomer.amountSpent?.currencyCode || "USD";
      defaultAddress = shopifyCustomer.defaultAddress
        ? mapShopifyAddress(shopifyCustomer.defaultAddress)
        : null;
      addresses = (shopifyCustomer.addresses || []).map(mapShopifyAddress);
    }
  } catch (error) {
    console.error("Error fetching Shopify customer data:", error);
    // Continue with local data only
  }

  // 3. Fetch local orders
  const orders = customer.email
    ? await prisma.pickupSchedule.findMany({
        where: { shop, customerEmail: customer.email },
        include: {
          orderItems: true,
          subscriptionPickup: { select: { id: true, shopifyContractId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  // 4. Fetch local subscriptions
  const subscriptions = customer.email
    ? await prisma.subscriptionPickup.findMany({
        where: { shop, customerEmail: customer.email },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      })
    : [];

  // 5. Compute active subscription count
  const activeSubscriptionCount = subscriptions.filter(
    (s) => s.status === "ACTIVE"
  ).length;

  // 6. Last order date
  const lastOrderDate =
    orders.length > 0 ? orders[0].createdAt.toISOString() : null;

  return {
    id: customer.id,
    shopifyCustomerId: customer.shopifyCustomerId,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    totalOrderCount,
    totalSpent,
    currency,
    activeSubscriptionCount,
    lastOrderDate,
    shopifyNote,
    shopifyTags,
    defaultAddress,
    addresses,
    memberSince,
    notes: customer.notes.map(mapNote),
    orders: orders.map((o) => ({
      id: o.id,
      shopifyOrderId: o.shopifyOrderId,
      shopifyOrderNumber: o.shopifyOrderNumber,
      pickupDate: o.pickupDate.toISOString(),
      pickupTimeSlot: o.pickupTimeSlot,
      pickupStatus: o.pickupStatus,
      isSubscription: !!o.subscriptionPickup,
      subscriptionContractId: o.subscriptionPickup?.shopifyContractId || null,
      items: o.orderItems.map((item) => ({
        productTitle: item.productTitle,
        variantTitle: item.variantTitle,
        quantity: item.quantity,
      })),
      createdAt: o.createdAt.toISOString(),
    })),
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      shopifyContractId: s.shopifyContractId,
      frequency: s.frequency,
      status: s.status,
      preferredDay: s.preferredDay,
      preferredTimeSlot: s.preferredTimeSlot,
      nextPickupDate: s.nextPickupDate?.toISOString() || null,
      discountPercent: s.discountPercent,
      adminNotes: s.adminNotes,
    })),
  };
}

// ============================================
// CUSTOMER UPSERT (from webhook or sync)
// ============================================

export interface UpsertCustomerInput {
  shopifyCustomerId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

export async function upsertCustomer(
  shop: string,
  input: UpsertCustomerInput
): Promise<string> {
  const { shopifyCustomerId, ...data } = input;

  try {
    const existing = await prisma.customer.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId } },
    });

    if (existing) {
      await prisma.customer.update({
        where: { id: existing.id },
        data: {
          ...(data.email !== undefined ? { email: data.email?.toLowerCase().trim() || null } : {}),
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.phone !== undefined ? { phone: data.phone, phoneNormalized: normalizePhone(data.phone) } : {}),
          lastSyncedAt: new Date(),
        },
      });
      return existing.id;
    } else {
      const newCustomer = await prisma.customer.create({
        data: {
          shop,
          shopifyCustomerId,
          email: data.email?.toLowerCase().trim() || null,
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          phone: data.phone || null,
          phoneNormalized: normalizePhone(data.phone),
          lastSyncedAt: new Date(),
        },
      });
      return newCustomer.id;
    }
  } catch (error) {
    // Handle unique constraint violation on email (different customer, same email)
    const errorStr = String(error);
    if (errorStr.includes("Unique constraint") && errorStr.includes("email")) {
      console.warn(
        `Customer email conflict for ${input.email}, updating by email instead`
      );
      const byEmail = await prisma.customer.findFirst({
        where: { shop, email: input.email?.toLowerCase().trim() },
      });
      if (byEmail) {
        const mergedPhone = data.phone || byEmail.phone;
        await prisma.customer.update({
          where: { id: byEmail.id },
          data: {
            shopifyCustomerId,
            firstName: data.firstName || byEmail.firstName,
            lastName: data.lastName || byEmail.lastName,
            phone: mergedPhone,
            phoneNormalized: normalizePhone(mergedPhone),
            lastSyncedAt: new Date(),
          },
        });
        return byEmail.id;
      }
    }
    throw error;
  }
}

// ============================================
// SYNC CUSTOMERS FROM SHOPIFY
// ============================================

/**
 * Syncs customers from Shopify's Customers API into the local Customer table.
 * Primary source: Shopify Customers API (paginated, fetches all customers).
 * Secondary enrichment: local PickupSchedule + SubscriptionPickup data for
 * customers that exist in local orders but not yet in Shopify (edge case).
 */
export async function syncCustomersFromLocalData(
  shop: string,
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> }
): Promise<number> {
  let synced = 0;
  const processedEmails = new Set<string>();

  // === Phase 1: Fetch all customers from Shopify Customers API ===
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    try {
      const response = await admin.graphql(
        `query listCustomers($first: Int!, $after: String) {
          customers(first: $first, after: $after) {
            edges {
              node {
                id
                email
                firstName
                lastName
                phone
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }`,
        { variables: { first: 50, after: cursor } }
      );

      const result = await response.json();
      const errors = (result as any)?.errors;
      if (errors) {
        console.error("Shopify GraphQL errors in customer sync:", JSON.stringify(errors));
      }
      const edges = (result as any)?.data?.customers?.edges || [];
      const pageInfo = (result as any)?.data?.customers?.pageInfo;

      if (edges.length === 0) {
        console.log("Shopify returned 0 customers — check API scopes (read_customers required)");
        break;
      }

      for (const edge of edges) {
        const node = edge.node;
        if (!node) continue;

        try {
          await upsertCustomer(shop, {
            shopifyCustomerId: node.id,
            email: node.email || null,
            firstName: node.firstName || null,
            lastName: node.lastName || null,
            phone: node.phone || null,
          });
          synced++;
          if (node.email) {
            processedEmails.add(node.email.toLowerCase().trim());
          }
        } catch (error) {
          console.error(`Error upserting Shopify customer ${node.email || node.id}:`, error);
        }
      }

      hasNextPage = pageInfo?.hasNextPage === true;
      cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

      // Respect Shopify API rate limits
      if (hasNextPage) {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (error) {
      console.error("Error fetching customers from Shopify:", error);
      hasNextPage = false;
    }
  }

  // === Phase 2: Fill gaps from local order/subscription data ===
  // Some customers may exist in local orders but not in Shopify (e.g., deleted customers)
  const orderEmails = await prisma.pickupSchedule.findMany({
    where: { shop, AND: [{ customerEmail: { not: null } }, { customerEmail: { not: "" } }] },
    select: { customerEmail: true, customerName: true, customerPhone: true },
    distinct: ["customerEmail"],
    orderBy: { createdAt: "desc" },
  });

  const subEmails = await prisma.subscriptionPickup.findMany({
    where: { shop, AND: [{ customerEmail: { not: null } }, { customerEmail: { not: "" } }] },
    select: { customerEmail: true, customerName: true, customerPhone: true },
    distinct: ["customerEmail"],
    orderBy: { createdAt: "desc" },
  });

  for (const row of [...orderEmails, ...subEmails]) {
    if (!row.customerEmail) continue;
    const email = row.customerEmail.toLowerCase().trim();
    if (!email || processedEmails.has(email)) continue;
    processedEmails.add(email);

    try {
      const nameParts = (row.customerName || "").split(" ");
      await upsertCustomer(shop, {
        shopifyCustomerId: `local:${email}`,
        email,
        firstName: nameParts[0] || null,
        lastName: nameParts.slice(1).join(" ") || null,
        phone: row.customerPhone || null,
      });
      synced++;
    } catch (error) {
      console.error(`Error syncing local customer ${email}:`, error);
    }
  }

  return synced;
}

// ============================================
// RESOLVE LOCAL CUSTOMER → SHOPIFY GID
// ============================================

/**
 * For customers with `local:` prefix shopifyCustomerId, look them up
 * in Shopify by email and update the record with the real Shopify GID.
 * Returns the updated shopifyCustomerId, or null if not found in Shopify.
 */
export async function resolveLocalCustomer(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shop: string,
  customerId: string
): Promise<string | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shop },
  });

  if (!customer) return null;
  if (!customer.shopifyCustomerId.startsWith("local:")) {
    return customer.shopifyCustomerId; // Already resolved
  }

  if (!customer.email) return null;

  try {
    // Search Shopify for customer by email
    const response = await admin.graphql(
      `query findCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              email
              firstName
              lastName
              phone
            }
          }
        }
      }`,
      { variables: { query: `email:"${customer.email}"` } }
    );

    const result = await response.json();
    const gqlErrors = (result as any)?.errors;
    if (gqlErrors) {
      console.error("resolveLocalCustomer GraphQL errors:", JSON.stringify(gqlErrors));
      return null;
    }
    const edges = (result as any)?.data?.customers?.edges || [];
    console.log(`resolveLocalCustomer: searched email "${customer.email}", found ${edges.length} results`);

    if (edges.length > 0) {
      const node = edges[0].node;
      console.log(`resolveLocalCustomer: resolving ${customer.email} → ${node.id}`);

      try {
        // Check if a record with this Shopify GID already exists (unique constraint)
        const existing = await prisma.customer.findFirst({
          where: { shop, shopifyCustomerId: node.id },
        });

        if (existing && existing.id !== customerId) {
          // Another record already has this Shopify GID — merge: delete local: record,
          // update existing with any missing data, return existing GID
          console.log(`resolveLocalCustomer: merging into existing record ${existing.id}`);
          // Move any notes from local record to the existing one
          await prisma.customerNote.updateMany({
            where: { customerId },
            data: { customerId: existing.id },
          });
          // Move any SMS messages from local record to the existing one
          await prisma.smsMessage.updateMany({
            where: { customerId },
            data: { customerId: existing.id },
          });
          // Delete the local: duplicate
          await prisma.customer.delete({ where: { id: customerId } });
          return node.id;
        }

        // No conflict — update the local record with the real Shopify GID
        await prisma.customer.update({
          where: { id: customerId },
          data: {
            shopifyCustomerId: node.id,
            firstName: node.firstName || customer.firstName,
            lastName: node.lastName || customer.lastName,
            phone: node.phone || customer.phone,
            lastSyncedAt: new Date(),
          },
        });
        return node.id;
      } catch (updateError) {
        console.error(`resolveLocalCustomer: Prisma update failed for ${customer.email}:`, updateError);
        return null;
      }
    }

    return null;
  } catch (error) {
    console.error(`Error resolving local customer ${customer.email}:`, error);
    return null;
  }
}

// ============================================
// FIND CUSTOMER BY SHOPIFY GID (for merge redirects)
// ============================================

export async function findCustomerByShopifyGid(
  shop: string,
  shopifyGid: string
): Promise<{ id: string } | null> {
  return prisma.customer.findFirst({
    where: { shop, shopifyCustomerId: shopifyGid },
    select: { id: true },
  });
}

// ============================================
// CUSTOMER NOTES CRUD
// ============================================

export async function addCustomerNote(
  shop: string,
  customerId: string,
  content: string,
  category?: string,
  createdBy?: string
): Promise<CustomerNoteData> {
  const note = await prisma.customerNote.create({
    data: {
      shop,
      customerId,
      content: content.substring(0, 2000), // limit note length
      category: category || "general",
      createdBy: createdBy || null,
    },
  });
  return mapNote(note);
}

export async function updateCustomerNote(
  noteId: string,
  content: string,
  category?: string,
  isPinned?: boolean
): Promise<CustomerNoteData> {
  const note = await prisma.customerNote.update({
    where: { id: noteId },
    data: {
      content: content.substring(0, 2000),
      ...(category !== undefined ? { category } : {}),
      ...(isPinned !== undefined ? { isPinned } : {}),
    },
  });
  return mapNote(note);
}

export async function deleteCustomerNote(noteId: string): Promise<void> {
  await prisma.customerNote.delete({ where: { id: noteId } });
}

export async function togglePinNote(noteId: string): Promise<CustomerNoteData> {
  const existing = await prisma.customerNote.findUniqueOrThrow({
    where: { id: noteId },
  });
  const note = await prisma.customerNote.update({
    where: { id: noteId },
    data: { isPinned: !existing.isPinned },
  });
  return mapNote(note);
}

// ============================================
// SHOPIFY NOTES SYNC
// ============================================

export async function syncNotesToShopify(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shop: string,
  customerId: string
): Promise<{ success: boolean; error?: string }> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shop },
    include: {
      notes: {
        where: { isPinned: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!customer || customer.shopifyCustomerId.startsWith("local:")) {
    return { success: false, error: "No Shopify customer linked" };
  }

  // Compile pinned notes into a formatted string
  const noteText = customer.notes
    .map(
      (n) =>
        `[${(n.category || "general").toUpperCase()}] ${n.content} (${n.createdAt.toLocaleDateString()})`
    )
    .join("\n\n");

  try {
    const response = await admin.graphql(
      `mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id note }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            id: customer.shopifyCustomerId,
            note: noteText || null,
          },
        },
      }
    );

    const result = await response.json();
    const errors = (result as any)?.data?.customerUpdate?.userErrors;
    if (errors && errors.length > 0) {
      return { success: false, error: errors[0].message };
    }

    // Mark notes as synced
    await prisma.customerNote.updateMany({
      where: { customerId, isPinned: true },
      data: { syncedToShopify: true },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============================================
// HELPERS
// ============================================

function mapNote(note: {
  id: string;
  content: string;
  category: string | null;
  isPinned: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CustomerNoteData {
  return {
    id: note.id,
    content: note.content,
    category: note.category,
    isPinned: note.isPinned,
    createdBy: note.createdBy,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function mapShopifyAddress(addr: any): ShopifyAddress {
  return {
    address1: addr.address1 || null,
    address2: addr.address2 || null,
    city: addr.city || null,
    province: addr.province || null,
    zip: addr.zip || null,
    country: addr.country || null,
    phone: addr.phone || null,
  };
}
