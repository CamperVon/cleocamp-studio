import { isConfigured, shopifyGraphQL } from '@/lib/integrations/shopify'

/**
 * The customer's order, found by code — never chosen by the model reading the
 * email. By an order number quoted in the email first (exact), then by the
 * sender's address (most recent). A customer writing from a different address
 * than they ordered with simply gets no match, and the case says so.
 */
export type OrderSnapshot = {
  id: string
  name: string
  createdAt: string
  financialStatus: string | null
  fulfillmentStatus: string | null
  total: string | null
  email: string | null
  items: Array<{ title: string; variant: string | null; quantity: number }>
  tracking: Array<{ company: string | null; number: string | null; url: string | null }>
  /** Where it is going. Optional: snapshots taken before 24 Sept 2026 lack it. */
  shipTo?: ShipTo | null
}

export type ShipTo = {
  name: string | null; address1: string | null; address2: string | null
  city: string | null; provinceCode: string | null; zip: string | null; countryCode: string | null
}

type Node = {
  id: string
  name: string
  createdAt: string
  email: string | null
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string | null
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null
  lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number }> }
  fulfillments: Array<{ trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }> }>
  shippingAddress: (Omit<ShipTo, 'countryCode'> & { countryCodeV2: string | null }) | null
}

const ORDER_FIELDS = `
  id name createdAt email displayFinancialStatus displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 20) { nodes { title variantTitle quantity } }
  fulfillments(first: 5) { trackingInfo(first: 3) { company number url } }
  shippingAddress { name address1 address2 city provinceCode zip countryCodeV2 }
`

function snapshot(n: Node): OrderSnapshot {
  return {
    id: n.id,
    name: n.name,
    createdAt: n.createdAt,
    financialStatus: n.displayFinancialStatus,
    fulfillmentStatus: n.displayFulfillmentStatus,
    total: n.totalPriceSet ? `${n.totalPriceSet.shopMoney.amount} ${n.totalPriceSet.shopMoney.currencyCode}` : null,
    email: n.email,
    items: n.lineItems.nodes.map((l) => ({ title: l.title, variant: l.variantTitle, quantity: l.quantity })),
    tracking: n.fulfillments.flatMap((f) => f.trackingInfo),
    shipTo: n.shippingAddress
      ? {
          name: n.shippingAddress.name, address1: n.shippingAddress.address1, address2: n.shippingAddress.address2,
          city: n.shippingAddress.city, provinceCode: n.shippingAddress.provinceCode, zip: n.shippingAddress.zip,
          countryCode: n.shippingAddress.countryCodeV2,
        }
      : null,
  }
}

async function search(query: string, first: number): Promise<OrderSnapshot[]> {
  const d = await shopifyGraphQL<{ orders: { nodes: Node[] } }>(
    `query($q: String!, $n: Int!) { orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } } }`,
    { q: query, n: first },
  )
  return d.orders.nodes.map(snapshot)
}

export async function findOrder(email: string, quotedNames: string[]): Promise<
  { order: OrderSnapshot | null; recent: OrderSnapshot[]; note: string | null }
> {
  if (!isConfigured()) return { order: null, recent: [], note: 'Shopify is not connected' }
  try {
    for (const name of quotedNames) {
      const [hit] = await search(`name:${name}`, 1)
      // An order number alone could be anyone's — only trust it when the
      // address matches too, or when there is no address to check against.
      if (hit && (!hit.email || hit.email.toLowerCase() === email)) {
        return { order: hit, recent: [], note: null }
      }
    }
    const recent = await search(`email:${email}`, 3)
    return {
      order: recent[0] ?? null,
      recent,
      note: recent.length ? null : `No Shopify order under ${email}${quotedNames.length ? ` or ${quotedNames.join(', ')}` : ''}`,
    }
  } catch (e) {
    return { order: null, recent: [], note: `Order lookup failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` }
  }
}

/** The order as it is right now — re-read before anything is changed, never trusted from a snapshot. */
export async function freshOrder(id: string): Promise<OrderSnapshot | null> {
  const d = await shopifyGraphQL<{ order: Node | null }>(`query($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id })
  return d.order ? snapshot(d.order) : null
}

/**
 * Change where an order ships. Called only from a person's tap on the
 * support page, after the checks in lib/support/reply.ts have passed against
 * a fresh read of the order. Needs the app's write_orders access in Shopify.
 */
export async function setShippingAddress(id: string, a: ShipTo): Promise<{ ok: true } | { ok: false; error: string }> {
  const [firstName, ...rest] = (a.name ?? '').trim().split(/\s+/)
  const d = await shopifyGraphQL<{ orderUpdate: { userErrors: Array<{ field: string[] | null; message: string }> } }>(
    `mutation($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`,
    {
      input: {
        id,
        shippingAddress: {
          firstName: firstName || null, lastName: rest.join(' ') || null,
          address1: a.address1, address2: a.address2 || null, city: a.city,
          provinceCode: a.provinceCode, zip: a.zip, countryCode: a.countryCode ?? 'US',
        },
      },
    },
  )
  const errs = d.orderUpdate.userErrors
  return errs.length ? { ok: false, error: errs.map((e) => e.message).join('; ') } : { ok: true }
}
