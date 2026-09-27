/**
 * Returns that reach the studio. Brandon, 27 Sept 2026: "when returns come
 * into the studio, i want jane (or anyone) to be able to type in order number
 * and it will process it and send email. if it's a thread that we have been
 * waiting for, close it up after. if it's an order w/o a thread, create one.
 * once okayed internally we can refund minus the stocking fee."
 *
 * Two taps, by a person each time:
 *   1. Received — the parcel is in the studio. The customer is emailed that it
 *      arrived. An exchange is then closed (the replacement is sent the usual
 *      way); a refund waits, open, for someone to check the item and approve.
 *   2. Refund — Shopify refunds the returned items less the 10% restocking
 *      fee (the policy on the website since 25 Sept 2026), puts them back in
 *      the studio's stock, and the customer is emailed that it is done.
 *
 * The fee is 10% of the items' price. The tax on them is refunded in full:
 * the fee is ours, the tax never was. Shipping is not refunded.
 */
import { shopifyGraphQL } from '@/lib/integrations/shopify'

export const RESTOCKING_FEE = 0.1

export type ReturnKind = 'REFUND' | 'EXCHANGE'
export type ReturnLine = { lineItemId: string; quantity: number; label: string }
export type ReturnInfo = {
  orderId: string
  orderName: string
  kind: ReturnKind
  lines: ReturnLine[]
  receivedAt: string
  receivedBy: string
  refundedAt?: string
  refunded?: number
  fee?: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The fee kept and the amount refunded, from Shopify's own figures. Pure. */
export function refundLessFee(suggestedTotal: number, itemsSubtotal: number): { fee: number; refund: number } {
  const fee = round2(itemsSubtotal * RESTOCKING_FEE)
  return { fee, refund: round2(Math.max(0, suggestedTotal - fee)) }
}

/** Customers type "2237", "#2237" or "order 2237". Pure. */
export function orderNameFrom(input: string): string | null {
  const m = input.match(/(\d{3,6})/)
  return m ? `#${m[1]}` : null
}

export type ReturnOrder = {
  id: string
  name: string
  email: string | null
  customerName: string | null
  cancelled: boolean
  items: Array<{ id: string; label: string; quantity: number; shipped: number; refundable: number; unitPrice: number }>
}

type Money = { shopMoney: { amount: string } }

export async function findReturnOrder(name: string): Promise<ReturnOrder | null> {
  const d = await shopifyGraphQL<{ orders: { nodes: Array<{
    id: string; name: string; email: string | null; cancelledAt: string | null
    shippingAddress: { name: string | null } | null; billingAddress: { name: string | null } | null
    lineItems: { nodes: Array<{ id: string; title: string; variantTitle: string | null; quantity: number; currentQuantity: number; unfulfilledQuantity: number; refundableQuantity: number; originalUnitPriceSet: Money }> }
  }> } }>(
    `query($q: String!) { orders(first: 1, query: $q) { nodes { id name email cancelledAt shippingAddress { name } billingAddress { name }
      lineItems(first: 20) { nodes { id title variantTitle quantity currentQuantity unfulfilledQuantity refundableQuantity originalUnitPriceSet { shopMoney { amount } } } } } } }`,
    { q: `name:${name}` },
  )
  const o = d.orders.nodes.find((n) => n.name === name)
  if (!o) return null
  return {
    id: o.id,
    name: o.name,
    email: o.email,
    customerName: o.shippingAddress?.name ?? o.billingAddress?.name ?? null,
    cancelled: !!o.cancelledAt,
    items: o.lineItems.nodes.map((l) => ({
      id: l.id,
      label: `${l.title}${l.variantTitle ? ` — ${l.variantTitle}` : ''}`,
      quantity: l.quantity,
      shipped: Math.max(0, l.currentQuantity - l.unfulfilledQuantity),
      refundable: l.refundableQuantity,
      unitPrice: Number(l.originalUnitPriceSet.shopMoney.amount),
    })),
  }
}

type Suggested = {
  amountSet: Money; subtotalSet: Money; totalTaxSet: Money
  suggestedTransactions: Array<{ gateway: string; parentTransaction: { id: string } | null; amountSet: Money }>
}

async function suggest(orderId: string, lines: ReturnLine[], locationId: string): Promise<Suggested> {
  const d = await shopifyGraphQL<{ order: { suggestedRefund: Suggested | null } | null }>(
    `query($id: ID!, $lines: [RefundLineItemInput!]) { order(id: $id) { suggestedRefund(refundLineItems: $lines, suggestFullRefund: false) {
      amountSet { shopMoney { amount } } subtotalSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } }
      suggestedTransactions { gateway parentTransaction { id } amountSet { shopMoney { amount } } } } } }`,
    { id: orderId, lines: lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity, restockType: 'RETURN', locationId })) },
  )
  const s = d.order?.suggestedRefund
  if (!s) throw new Error('Shopify could not work out a refund for those items.')
  return s
}

export type RefundQuote = { itemsSubtotal: number; tax: number; fee: number; refund: number }

/** What the refund will be. Changes nothing. */
export async function quoteReturnRefund(orderId: string, lines: ReturnLine[], locationId: string): Promise<RefundQuote> {
  const s = await suggest(orderId, lines, locationId)
  const itemsSubtotal = Number(s.subtotalSet.shopMoney.amount)
  const { fee, refund } = refundLessFee(Number(s.amountSet.shopMoney.amount), itemsSubtotal)
  return { itemsSubtotal, tax: Number(s.totalTaxSet.shopMoney.amount), fee, refund }
}

/**
 * Refund the returned items less the fee, and put them back in the studio's
 * stock. The idempotency key is the order and the case, so a second tap is
 * the same refund to Shopify and cannot pay out twice.
 */
export async function refundReturn(orderId: string, lines: ReturnLine[], locationId: string, key: string, note: string): Promise<RefundQuote> {
  const s = await suggest(orderId, lines, locationId)
  const itemsSubtotal = Number(s.subtotalSet.shopMoney.amount)
  const { fee, refund } = refundLessFee(Number(s.amountSet.shopMoney.amount), itemsSubtotal)
  const paid = s.suggestedTransactions.filter((t) => Number(t.amountSet.shopMoney.amount) > 0)
  if (paid.length !== 1 || !paid[0].parentTransaction) {
    throw new Error('This order was paid in more than one way, so the refund has to be split by hand in Shopify.')
  }
  const r = await shopifyGraphQL<{ refundCreate: { refund: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: RefundInput!, $key: String!) { refundCreate(input: $input) @idempotent(key: $key) { refund { id } userErrors { message } } }`,
    {
      key,
      input: {
        orderId, note: note.slice(0, 250), notify: false,
        refundLineItems: lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity, restockType: 'RETURN', locationId })),
        transactions: [{ orderId, gateway: paid[0].gateway, kind: 'REFUND', amount: refund.toFixed(2), parentId: paid[0].parentTransaction.id }],
      },
    },
  )
  if (!r.refundCreate.refund) throw new Error(r.refundCreate.userErrors.map((e) => e.message).join('; ') || 'Shopify did not create the refund.')
  return { itemsSubtotal, tax: Number(s.totalTaxSet.shopMoney.amount), fee, refund }
}

const listOf = (lines: ReturnLine[]) => lines.map((l) => `${l.quantity > 1 ? `${l.quantity} × ` : ''}${l.label}`).join(', ')

/** Fixed text, not a model's: what the customer hears when the parcel lands. Pure. */
export function returnReceivedText(firstName: string | null, info: Pick<ReturnInfo, 'orderName' | 'kind' | 'lines'>): string {
  const next = info.kind === 'REFUND'
    ? "We'll check it over and refund it to your original payment, less the 10% restocking fee. You'll get another email from us when that's done."
    : "We'll send your replacement out and let you know when it's on its way."
  return `Hi ${firstName ?? 'there'},\n\nYour return for order ${info.orderName} (${listOf(info.lines)}) has arrived at the studio. ${next}\n\nKindly,\nCleo Studio`
}

/** Fixed text: the refund has been issued. Pure. */
export function returnRefundedText(firstName: string | null, orderName: string, q: Pick<RefundQuote, 'refund' | 'fee'>): string {
  return `Hi ${firstName ?? 'there'},\n\nWe've refunded $${q.refund.toFixed(2)} for your return on order ${orderName} to your original payment, less the 10% restocking fee ($${q.fee.toFixed(2)}). It can take a few days to show on your statement.\n\nKindly,\nCleo Studio`
}
