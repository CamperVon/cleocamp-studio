/**
 * Any order's status, by number, for the box at the top of Support. Brandon,
 * 29 Sept 2026: "above the returns section we should have an order box, where
 * we can type in any order for a status." Read only: it looks, it changes
 * nothing.
 */
import { shopifyGraphQL } from '@/lib/integrations/shopify'

type Money = { shopMoney: { amount: string } }

export type OrderStatus = {
  name: string
  adminUrl: string
  placed: string
  customer: string | null
  email: string | null
  shipTo: string | null
  kind: 'web' | 'live sale' | 'wholesale'
  cancelled: string | null
  paid: string
  fulfilment: string
  total: number
  /** Refunds made, including ones Shopify Payments still shows pending. */
  refunded: number
  refundPending: number
  items: Array<{ label: string; ordered: number; now: number; toShip: number }>
  shipments: Array<{ date: string; status: string; delivered: string | null; tracking: Array<{ company: string | null; number: string | null; url: string | null }> }>
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' })
const words = (s: string | null | undefined) => (s ?? 'unknown').toLowerCase().replace(/_/g, ' ')

/** "2237", "#2237", "order 2237" → "#2237". Pure. */
export function orderName(input: string): string | null {
  const m = input.match(/(\d{3,6})/)
  return m ? `#${m[1]}` : null
}

const sumRefunds = (ts: Array<{ kind: string; status: string; amountSet: Money }>, statuses: string[]) =>
  Math.round(ts.filter((t) => t.kind === 'REFUND' && statuses.includes(t.status)).reduce((n, t) => n + Number(t.amountSet.shopMoney.amount), 0) * 100) / 100

export async function orderStatus(name: string): Promise<OrderStatus | null> {
  const d = await shopifyGraphQL<{ orders: { nodes: Array<{
    name: string; legacyResourceId: string; createdAt: string; cancelledAt: string | null; cancelReason: string | null
    email: string | null; tags: string[]; displayFinancialStatus: string | null; displayFulfillmentStatus: string | null
    totalPriceSet: Money
    transactions: Array<{ kind: string; status: string; amountSet: Money }>
    shippingAddress: { name: string | null; city: string | null; provinceCode: string | null; countryCodeV2: string | null } | null
    billingAddress: { name: string | null } | null
    lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number; currentQuantity: number; unfulfilledQuantity: number }> }
    fulfillments: Array<{ createdAt: string; status: string; displayStatus: string | null; deliveredAt: string | null; trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }> }>
  }> }; shop: { myshopifyDomain: string } }>(
    `query($q: String!) { orders(first: 5, query: $q) { nodes { name legacyResourceId createdAt cancelledAt cancelReason email tags
      displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount } }
      transactions(first: 30) { kind status amountSet { shopMoney { amount } } }
      shippingAddress { name city provinceCode countryCodeV2 } billingAddress { name }
      lineItems(first: 50) { nodes { title variantTitle quantity currentQuantity unfulfilledQuantity } }
      fulfillments { createdAt status displayStatus deliveredAt trackingInfo { company number url } } } }
      shop { myshopifyDomain } }`,
    { q: `name:${name}` },
  )
  const o = d.orders.nodes.find((n) => n.name === name)
  if (!o) return null
  const a = o.shippingAddress
  return {
    name: o.name,
    adminUrl: `https://admin.shopify.com/store/${d.shop.myshopifyDomain.replace(/\.myshopify\.com$/, '')}/orders/${o.legacyResourceId}`,
    placed: day(o.createdAt),
    customer: a?.name ?? o.billingAddress?.name ?? null,
    email: o.email,
    shipTo: a ? [a.city, a.provinceCode, a.countryCodeV2 && a.countryCodeV2 !== 'US' ? a.countryCodeV2 : null].filter(Boolean).join(', ') || null : null,
    kind: o.tags.includes('wholesale') ? 'wholesale' : o.tags.includes('live-sale') ? 'live sale' : 'web',
    cancelled: o.cancelledAt ? `${day(o.cancelledAt)}${o.cancelReason ? ` (${words(o.cancelReason)})` : ''}` : null,
    // "Pending" on an invoice means not paid yet; say it plainly.
    paid: o.displayFinancialStatus === 'PENDING' ? 'not paid yet' : words(o.displayFinancialStatus),
    fulfilment: words(o.displayFulfillmentStatus),
    total: Number(o.totalPriceSet.shopMoney.amount),
    // Shopify's own "total refunded" leaves out a refund still pending at the
    // card processor (#2642's Friends and Family refund read $0 for days), so
    // it is added up from the refund transactions instead.
    refunded: sumRefunds(o.transactions, ['SUCCESS', 'PENDING']),
    refundPending: sumRefunds(o.transactions, ['PENDING']),
    items: o.lineItems.nodes.map((l) => ({
      label: `${l.title}${l.variantTitle ? ` — ${l.variantTitle}` : ''}`,
      ordered: l.quantity, now: l.currentQuantity, toShip: l.unfulfilledQuantity,
    })),
    shipments: o.fulfillments.filter((f) => f.status !== 'CANCELLED').map((f) => ({
      date: day(f.createdAt), status: words(f.displayStatus ?? f.status), delivered: f.deliveredAt ? day(f.deliveredAt) : null, tracking: f.trackingInfo,
    })),
  }
}
