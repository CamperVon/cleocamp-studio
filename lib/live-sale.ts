/**
 * Live sales, invoiced through Shopify. Brandon, 27 Sept 2026: "please invoice
 * jane doe for a boy belt size m. mouse will deduct the inventory and send the
 * invoice ... so it can be paid directly to us. (these are for live sales.)"
 *
 * Shopify, not QuickBooks, on purpose. Shopify is the master for finished
 * goods (CLAUDE.md §3), so a Shopify order takes the item off stock by itself
 * and the nightly sync carries that into the ledger — no second count to keep
 * in step, and nothing here writes an InventoryEvent (that would count the
 * sale twice). The sale also lands in the sales history the forecast reads,
 * and flows to QuickBooks through the existing Shopify sync. The app's own
 * QuickBooks connection stays dormant, as decided on 12 Sept.
 *
 * The flow, only ever on a person's say-so in the chat:
 *   1. a draft order at the retail price (or a price the person named);
 *   2. completed as an unpaid order — the item leaves stock now, because it
 *      left the table now;
 *   3. marked handed over (fulfilled), so it never reaches the packing list;
 *   4. Shopify emails the customer the invoice, with a link to pay.
 * Tax is Shopify's own: with no address it charges the shop's (LA, 9.75%),
 * which is right for a sale made in person there.
 */
import { shopifyGraphQL } from '@/lib/integrations/shopify'

export type SaleLine = { shopifyVariantId: string; label: string; quantity: number; priceOverride?: number | null }

type Money = { shopMoney: { amount: string } }
const gid = (id: string) => (id.startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`)
const money = (m: Money | null | undefined) => Number(m?.shopMoney.amount ?? 0)

function draftInput(email: string, lines: SaleLine[], note: string) {
  return {
    email,
    note,
    tags: ['live-sale', 'studio-mouse'],
    lineItems: lines.map((l) => ({
      variantId: gid(l.shopifyVariantId),
      quantity: l.quantity,
      ...(l.priceOverride != null ? { priceOverride: { amount: l.priceOverride.toFixed(2), currencyCode: 'USD' } } : {}),
    })),
  }
}

export type Quote = {
  lines: Array<{ label: string; quantity: number; unitPrice: number; priced: 'retail' | 'named' }>
  subtotal: number
  tax: number
  total: number
}

/** What the invoice will say, worked out by Shopify. Creates nothing. */
export async function quoteLiveSale(email: string, lines: SaleLine[]): Promise<Quote> {
  const d = await shopifyGraphQL<{ draftOrderCalculate: { calculatedDraftOrder: {
    subtotalPriceSet: Money; totalTaxSet: Money; totalPriceSet: Money
    lineItems: Array<{ quantity: number; originalUnitPriceSet: Money; discountedUnitPriceSet?: Money }>
  } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: DraftOrderInput!) { draftOrderCalculate(input: $input) { calculatedDraftOrder {
      subtotalPriceSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } }
      lineItems { quantity originalUnitPriceSet { shopMoney { amount } } }
    } userErrors { message } } }`,
    { input: draftInput(email, lines, '') },
  )
  const c = d.draftOrderCalculate.calculatedDraftOrder
  if (!c) throw new Error(d.draftOrderCalculate.userErrors.map((e) => e.message).join('; ') || 'Shopify could not price this.')
  return {
    lines: lines.map((l, i) => ({
      label: l.label,
      quantity: l.quantity,
      unitPrice: l.priceOverride ?? money(c.lineItems[i]?.originalUnitPriceSet),
      priced: l.priceOverride != null ? 'named' : 'retail',
    })),
    subtotal: money(c.subtotalPriceSet),
    tax: money(c.totalTaxSet),
    total: money(c.totalPriceSet),
  }
}

export type InvoiceResult = {
  orderName: string | null
  orderId: string | null
  total: number | null
  fulfilled: boolean
  invoiceSent: boolean
  /** Anything that did not happen, in words for the person, with what to do. */
  problems: string[]
}

/**
 * Create, hand over and invoice. Stops at the first step that fails and says
 * exactly what state that leaves, so nothing half-done goes unmentioned.
 */
export async function invoiceLiveSale(args: {
  email: string
  customerName: string
  lines: SaleLine[]
  note: string
}): Promise<InvoiceResult> {
  const out: InvoiceResult = { orderName: null, orderId: null, total: null, fulfilled: false, invoiceSent: false, problems: [] }

  const created = await shopifyGraphQL<{ draftOrderCreate: { draftOrder: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { message } } }`,
    { input: draftInput(args.email, args.lines, args.note) },
  )
  const draftId = created.draftOrderCreate.draftOrder?.id
  if (!draftId) {
    out.problems.push(`Shopify would not create the order: ${created.draftOrderCreate.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Nothing was created, charged or sent.`)
    return out
  }

  // Unpaid order: stock leaves now, payment follows through the invoice.
  const done = await shopifyGraphQL<{ draftOrderComplete: { draftOrder: { order: { id: string; name: string; totalPriceSet: Money } | null } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!) { draftOrderComplete(id: $id, paymentPending: true) { draftOrder { order { id name totalPriceSet { shopMoney { amount } } } } userErrors { message } } }`,
    { id: draftId },
  )
  const order = done.draftOrderComplete.draftOrder?.order
  if (!order) {
    out.problems.push(`The draft order was made but Shopify would not turn it into an order: ${done.draftOrderComplete.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Stock has not moved and nothing was sent; the draft is under Orders → Drafts in Shopify.`)
    return out
  }
  out.orderId = order.id
  out.orderName = order.name
  out.total = money(order.totalPriceSet)

  // Handed over at the table, so it must never reach the packing list.
  // Fulfillment orders appear a moment after the order does.
  let fulfillmentOrderIds: string[] = []
  for (let i = 0; i < 5 && !fulfillmentOrderIds.length; i++) {
    const fo = await shopifyGraphQL<{ order: { fulfillmentOrders: { nodes: Array<{ id: string; status: string }> } } | null }>(
      `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 5) { nodes { id status } } } }`,
      { id: order.id },
    )
    fulfillmentOrderIds = (fo.order?.fulfillmentOrders.nodes ?? []).filter((n) => n.status === 'OPEN').map((n) => n.id)
    if (!fulfillmentOrderIds.length) await new Promise((r) => setTimeout(r, 800))
  }
  if (fulfillmentOrderIds.length) {
    const f = await shopifyGraphQL<{ fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> } }>(
      `mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`,
      { f: { notifyCustomer: false, lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((id) => ({ fulfillmentOrderId: id })) } },
    )
    out.fulfilled = !!f.fulfillmentCreate.fulfillment
    if (!out.fulfilled) out.problems.push(`${order.name} was not marked handed over (${f.fulfillmentCreate.userErrors.map((e) => e.message).join('; ') || 'no reason given'}). Mark it fulfilled in Shopify, or it will show up to be packed and shipped.`)
  } else {
    out.problems.push(`${order.name} was not marked handed over — Shopify had nothing to fulfil yet. Mark it fulfilled in Shopify, or it will show up to be packed and shipped.`)
  }

  const first = args.customerName.trim().split(/\s+/)[0]
  const sent = await shopifyGraphQL<{ orderInvoiceSend: { order: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!, $email: EmailInput) { orderInvoiceSend(id: $id, email: $email) { order { id } userErrors { message } } }`,
    {
      id: order.id,
      email: {
        to: args.email,
        subject: `Your Cleo Camp invoice ${order.name}`,
        customMessage: `Hi ${first}, thank you for shopping with us in person. You can pay securely using the link below.\n\nKindly,\nCleo Studio`,
      },
    },
  )
  out.invoiceSent = !!sent.orderInvoiceSend.order && !sent.orderInvoiceSend.userErrors.length
  if (!out.invoiceSent) out.problems.push(`The invoice email did not go (${sent.orderInvoiceSend.userErrors.map((e) => e.message).join('; ') || 'no reason given'}). Open ${order.name} in Shopify and use "Send invoice".`)
  return out
}

/** Live sales still waiting on payment, newest first. */
export async function unpaidLiveSales(): Promise<Array<{ name: string; email: string | null; total: number; createdAt: string; status: string }>> {
  const d = await shopifyGraphQL<{ orders: { nodes: Array<{ name: string; email: string | null; createdAt: string; displayFinancialStatus: string | null; totalPriceSet: Money }> } }>(
    `query { orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "tag:live-sale AND financial_status:pending") { nodes { name email createdAt displayFinancialStatus totalPriceSet { shopMoney { amount } } } } }`,
  )
  return d.orders.nodes.map((o) => ({ name: o.name, email: o.email, total: money(o.totalPriceSet), createdAt: o.createdAt, status: o.displayFinancialStatus ?? 'unknown' }))
}
