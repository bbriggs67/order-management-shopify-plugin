/**
 * Customer CRM Service
 * Core business logic for the Customer Relationship Management portal.
 * Handles customer search, detail enrichment, note CRUD, and Shopify sync.
 */

import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
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
  orders: "totalOrderCount",
  spent: "totalSpent",
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
      totalOrderCount: c.totalOrderCount,
      totalSpent: c.totalSpent,
      currency: c.currency,
      activeSubscriptionCount: c.email
        ? subCountMap.get(c.email) || 0
        : 0,
      lastOrderDate: c.email ? lastOrderMap.get(c.email) || null : null,
      tags: c.tags,
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

  try {
    const response = await admin.graphql(
      `query getCustomerCRM($id: ID!) {
        customer(id: $id) {
          id
          note
          tags
          createdAt
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
    totalOrderCount: customer.totalOrderCount,
    totalSpent: customer.totalSpent,
    currency: customer.currency,
    activeSubscriptionCount,
    lastOrderDate,
    tags: customer.tags,
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
  totalOrderCount?: number;
  totalSpent?: string | null;
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
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.totalOrderCount !== undefined
            ? { totalOrderCount: data.totalOrderCount }
            : {}),
          ...(data.totalSpent !== undefined
            ? { totalSpent: data.totalSpent }
            : {}),
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
          totalOrderCount: data.totalOrderCount || 0,
          totalSpent: data.totalSpent || null,
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
        await prisma.customer.update({
          where: { id: byEmail.id },
          data: {
            shopifyCustomerId,
            firstName: data.firstName || byEmail.firstName,
            lastName: data.lastName || byEmail.lastName,
            phone: data.phone || byEmail.phone,
            totalOrderCount: data.totalOrderCount ?? byEmail.totalOrderCount,
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
// SYNC CUSTOMERS FROM LOCAL DATA
// ============================================

/**
 * Builds Customer records from existing PickupSchedule and SubscriptionPickup data.
 * Used for initial population and "Sync" button.
 * Also fetches Shopify customer data to fill in GIDs.
 */
export async function syncCustomersFromLocalData(
  shop: string,
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> }
): Promise<number> {
  // 1. Get distinct customer emails from orders
  const orderEmails = await prisma.pickupSchedule.findMany({
    where: { shop, customerEmail: { not: null } },
    select: {
      customerEmail: true,
      customerName: true,
      customerPhone: true,
    },
    distinct: ["customerEmail"],
    orderBy: { createdAt: "desc" },
  });

  // 2. Get distinct customer emails from subscriptions
  const subEmails = await prisma.subscriptionPickup.findMany({
    where: { shop, customerEmail: { not: null } },
    select: {
      customerEmail: true,
      customerName: true,
      customerPhone: true,
    },
    distinct: ["customerEmail"],
    orderBy: { createdAt: "desc" },
  });

  // 3. Merge into unique email map (prefer most recent data)
  const emailMap = new Map<
    string,
    { name: string; phone: string | null; email: string }
  >();

  for (const row of [...subEmails, ...orderEmails]) {
    if (!row.customerEmail) continue;
    const email = row.customerEmail.toLowerCase().trim();
    if (!emailMap.has(email)) {
      emailMap.set(email, {
        email,
        name: row.customerName,
        phone: row.customerPhone || null,
      });
    }
  }

  // 4. For each unique email, look up Shopify customer and upsert
  let synced = 0;

  for (const [email, data] of emailMap) {
    try {
      // Try to find Shopify customer by email
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
                ordersCount
                totalSpentV2 { amount currencyCode }
              }
            }
          }
        }`,
        { variables: { query: `email:${email}` } }
      );

      const result = await response.json();
      const shopifyCustomer = (result as any)?.data?.customers?.edges?.[0]?.node;

      if (shopifyCustomer) {
        // Parse name from local data as fallback
        const nameParts = data.name.split(" ");
        const firstName = shopifyCustomer.firstName || nameParts[0] || null;
        const lastName =
          shopifyCustomer.lastName || nameParts.slice(1).join(" ") || null;

        await upsertCustomer(shop, {
          shopifyCustomerId: shopifyCustomer.id,
          email,
          firstName,
          lastName,
          phone: shopifyCustomer.phone || data.phone,
          totalOrderCount: shopifyCustomer.ordersCount || 0,
          totalSpent: shopifyCustomer.totalSpentV2?.amount || null,
        });
        synced++;
      } else {
        // No Shopify customer found — create local-only record with placeholder GID
        const nameParts = data.name.split(" ");
        await upsertCustomer(shop, {
          shopifyCustomerId: `local:${email}`,
          email,
          firstName: nameParts[0] || null,
          lastName: nameParts.slice(1).join(" ") || null,
          phone: data.phone,
        });
        synced++;
      }

      // Small delay to respect Shopify API rate limits
      if (synced % 10 === 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (error) {
      console.error(`Error syncing customer ${email}:`, error);
      // Continue with other customers
    }
  }

  return synced;
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
