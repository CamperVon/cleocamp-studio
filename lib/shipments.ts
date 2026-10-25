import { shopifyGraphQL } from '@/lib/integrations/shopify'

/**
 * Marking what went out in a box (Brandon, 25 Oct 2026, after Cosimo's first
 * wholesale order sat paid and fully shipped for two weeks with nothing marked
 * in Shopify). Each box is marked as it ships, with only what is in it: that
 * is the moment Shopify takes those items off on-hand stock, and the rest of
 * the order stays held until its own box goes. Waiting to mark the whole
 * order at the end leaves everything in between looking as if it were still
 * on the shelf. Nothing here emails the customer.
 */

/** One unshipped line of an order, as Shopify holds it for fulfilment. */
export type OpenLine = {
  fulfillmentOrderId: string
  lineId: string
  remaining: number
  title: string
  variantTitle: string | null
  /** Shopify's numeric variant id; null for a typed-in (custom) line. */
  shopifyVariantId: string | null
}

/** What a person said went out: a variant by its Shopify id, or a custom line by its words. */
export type Ask = { shopifyVariantId?: string | null; description?: string | null; quantity: number; label: string }

export type Pick = { fulfillmentOrderId: string; lineId: string; quantity: number; label: string }

const numericId = (gid: string) => gid.replace(/^gid:\/\/shopify\/\w+\//, '')
const lineLabel = (l: OpenLine) => [l.title, l.variantTitle].filter(Boolean).join(' / ')
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
/** Every word of what was said appears in the line's title, in any order ("Cannellini Bean Bag" finds "Bean Bag / Cannellini / Petite"). */
const wordsIn = (said: string, title: string) => { const t = new Set(words(title)); const w = words(said); return w.length > 0 && w.every((x) => t.has(x)) }

/**
 * Which order lines a box covers. All or nothing: an item that matches no
 * open line, matches more than one typed-in line, or is more than is still
 * unshipped is a problem, and a plan with any problem must not be applied.
 * Pure.
 */
export function planShipment(open: OpenLine[], asks: Ask[]): { picks: Pick[]; problems: string[] } {
  const picks: Pick[] = []
  const problems: string[] = []
  const left = new Map(open.map((l) => [l.lineId, l.remaining]))
  for (const a of asks) {
    const qty = Math.round(Number(a.quantity))
    if (!(qty > 0)) { problems.push(`${a.label}: say how many went out.`); continue }
    let lines = a.shopifyVariantId
      ? open.filter((l) => l.shopifyVariantId === numericId(String(a.shopifyVariantId)))
      : open.filter((l) => !l.shopifyVariantId && !!a.description && wordsIn(a.description, lineLabel(l)))
    lines = lines.filter((l) => (left.get(l.lineId) ?? 0) > 0)
    if (!lines.length) { problems.push(`${a.label} is not on this order, or all of it is already marked shipped.`); continue }
    if (!a.shopifyVariantId && lines.length > 1) { problems.push(`"${a.description}" matches ${lines.length} lines (${lines.map(lineLabel).join('; ')}). Say which.`); continue }
    let need = qty
    for (const l of lines) {
      const take = Math.min(need, left.get(l.lineId) ?? 0)
      if (!take) continue
      picks.push({ fulfillmentOrderId: l.fulfillmentOrderId, lineId: l.lineId, quantity: take, label: a.label })
      left.set(l.lineId, (left.get(l.lineId) ?? 0) - take)
      need -= take
    }
    if (need > 0) problems.push(`${a.label}: ${qty} went out but only ${qty - need} ${qty - need === 1 ? 'is' : 'are'} still unshipped on this order.`)
  }
  return { picks, problems }
}

/** What is still unshipped after these picks, as readable lines. Pure. */
export function stillOpen(open: OpenLine[], picks: Pick[]): string[] {
  return open
    .map((l) => ({ l, n: l.remaining - picks.filter((p) => p.lineId === l.lineId).reduce((s, p) => s + p.quantity, 0) }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} × ${lineLabel(x.l)}`)
}

export type OrderToShip = { id: string; name: string; cancelled: boolean; tags: string[]; customer: string | null; open: OpenLine[] }

/** An order by its number ("#2749", "2749"), with every line not yet marked shipped. */
export async function orderToShip(nameIn: string): Promise<OrderToShip | null> {
  const name = `#${String(nameIn).replace(/[^0-9]/g, '')}`
  if (name === '#') return null
  type FO = { id: string; status: string; lineItems: { nodes: Array<{ id: string; remainingQuantity: number; lineItem: { title: string; variantTitle: string | null; variant: { id: string } | null } }> } }
  const r = await shopifyGraphQL<{ orders: { nodes: Array<{ id: string; name: string; cancelledAt: string | null; tags: string[]; customer: { displayName: string } | null; fulfillmentOrders: { nodes: FO[] } }> } }>(
    `query($q: String!) { orders(first: 1, query: $q) { nodes { id name cancelledAt tags customer { displayName }
      fulfillmentOrders(first: 10) { nodes { id status lineItems(first: 100) { nodes { id remainingQuantity lineItem { title variantTitle variant { id } } } } } } } } }`,
    { q: `name:${name}` },
  )
  const o = r.orders.nodes.find((n) => n.name === name)
  if (!o) return null
  const open: OpenLine[] = []
  for (const fo of o.fulfillmentOrders.nodes) {
    if (fo.status !== 'OPEN' && fo.status !== 'IN_PROGRESS') continue
    for (const li of fo.lineItems.nodes) {
      if (li.remainingQuantity <= 0) continue
      open.push({
        fulfillmentOrderId: fo.id, lineId: li.id, remaining: li.remainingQuantity,
        title: li.lineItem.title, variantTitle: li.lineItem.variantTitle,
        shopifyVariantId: li.lineItem.variant ? numericId(li.lineItem.variant.id) : null,
      })
    }
  }
  return { id: o.id, name: o.name, cancelled: !!o.cancelledAt, tags: o.tags, customer: o.customer?.displayName ?? null, open }
}

/** Mark these picks as shipped in Shopify, in one fulfilment, without emailing the customer. */
export async function markShipped(picks: Pick[], tracking?: { number?: string | null; company?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const byFo = new Map<string, Array<{ id: string; quantity: number }>>()
  for (const p of picks) byFo.set(p.fulfillmentOrderId, [...(byFo.get(p.fulfillmentOrderId) ?? []), { id: p.lineId, quantity: p.quantity }])
  const f = await shopifyGraphQL<{ fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`,
    {
      f: {
        notifyCustomer: false,
        ...(tracking?.number ? { trackingInfo: { number: tracking.number, ...(tracking.company ? { company: tracking.company } : {}) } } : {}),
        lineItemsByFulfillmentOrder: [...byFo].map(([fulfillmentOrderId, fulfillmentOrderLineItems]) => ({ fulfillmentOrderId, fulfillmentOrderLineItems })),
      },
    },
  )
  if (f.fulfillmentCreate.fulfillment) return { ok: true }
  return { ok: false, error: f.fulfillmentCreate.userErrors.map((e) => e.message).join('; ') || 'Shopify gave no reason' }
}

/**
 * Paid wholesale orders that ship and still have something unshipped after
 * `days` days, for the Daily Cheese. Cancelled orders are left out, and so
 * are unpaid ones (a deposit order waiting on production is not late).
 */
export async function slowWholesaleShipments(days = 7): Promise<Array<{ name: string; customer: string | null; createdAt: string; partly: boolean; units: number }>> {
  const before = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
  const r = await shopifyGraphQL<{ orders: { nodes: Array<{ name: string; createdAt: string; displayFulfillmentStatus: string; customer: { displayName: string } | null; lineItems: { nodes: Array<{ unfulfilledQuantity: number }> } }> } }>(
    `query($q: String!) { orders(first: 50, query: $q, sortKey: CREATED_AT) { nodes { name createdAt displayFulfillmentStatus customer { displayName } lineItems(first: 100) { nodes { unfulfilledQuantity } } } } }`,
    { q: `tag:wholesale tag:ships status:open financial_status:paid -fulfillment_status:shipped created_at:<${before}` },
  )
  return r.orders.nodes
    .map((o) => ({ name: o.name, customer: o.customer?.displayName ?? null, createdAt: o.createdAt, partly: o.displayFulfillmentStatus === 'PARTIALLY_FULFILLED', units: o.lineItems.nodes.reduce((s, l) => s + l.unfulfilledQuantity, 0) }))
    .filter((o) => o.units > 0)
}
