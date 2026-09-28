/**
 * Wholesale invoices sent through Shopify, on the Wholesale page. Brandon,
 * 28 Sept 2026: "the wholesale tab needs to be updated with any wholesale
 * invoices" — from that day forward only; older shipments stay as the
 * spreadsheet had them.
 *
 * Each sent invoice becomes a WholesaleShipment linked to its Shopify order,
 * with the lines and prices exactly as invoiced. Whether it is paid is read
 * from Shopify, never typed in: the invoice's pay link settles there.
 */
import { db } from '@/lib/db'
import { shopifyGraphQL } from '@/lib/integrations/shopify'

type Money = { shopMoney: { amount: string } }
const cents = (m: Money | null | undefined) => Math.round(Number(m?.shopMoney.amount ?? 0) * 100)

/** Record a sent wholesale draft against its account. Safe to call twice. */
export async function recordWholesaleInvoice(draftId: string, accountId: string): Promise<{ recorded: boolean; reason?: string }> {
  try {
    const d = await shopifyGraphQL<{ draftOrder: {
      order: { id: string; name: string; createdAt: string } | null
      shippingLine: { title: string } | null
      totalShippingPriceSet: Money
      lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number; discountedTotalSet: Money }> }
    } | null }>(
      `query($id: ID!) { draftOrder(id: $id) { order { id name createdAt } shippingLine { title } totalShippingPriceSet { shopMoney { amount } }
        lineItems(first: 250) { nodes { title variantTitle quantity discountedTotalSet { shopMoney { amount } } } } } }`,
      { id: draftId },
    )
    const o = d.draftOrder?.order
    if (!d.draftOrder || !o) return { recorded: false, reason: 'the draft has not become an order' }
    const lines = d.draftOrder.lineItems.nodes.map((l) => ({
      item: `${l.title}${l.variantTitle ? ` — ${l.variantTitle}` : ''}`, qty: l.quantity, wholesaleCents: cents(l.discountedTotalSet),
    }))
    const shipping = cents(d.draftOrder.totalShippingPriceSet)
    if (shipping) lines.push({ item: d.draftOrder.shippingLine?.title ?? 'Shipping & handling', qty: 1, wholesaleCents: shipping })
    await db.wholesaleShipment.upsert({
      where: { shopifyOrderId: o.id },
      update: {},
      create: {
        accountId, shopifyOrderId: o.id, invoiceName: o.name, sentAt: new Date(o.createdAt),
        // Just invoiced: known unpaid, not unknown.
        paid: false, notes: `Invoice ${o.name}, sent through Shopify`,
        lines: { create: lines },
      },
    })
    return { recorded: true }
  } catch (e) {
    return { recorded: false, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) }
  }
}

/**
 * Mark invoiced shipments paid once Shopify says so. One query for all of
 * them; called when the Wholesale page opens, so it is as fresh as the look.
 */
export async function syncWholesalePayments(): Promise<void> {
  const open = await db.wholesaleShipment.findMany({ where: { shopifyOrderId: { not: null }, NOT: { paid: true } }, select: { id: true, shopifyOrderId: true } })
  if (!open.length) return
  const r = await shopifyGraphQL<{ nodes: Array<{ id?: string; displayFinancialStatus?: string | null; transactions?: Array<{ kind: string; status: string; processedAt: string | null }> } | null> }>(
    `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id displayFinancialStatus transactions(first: 20) { kind status processedAt } } } }`,
    { ids: open.map((s) => s.shopifyOrderId!) },
  )
  for (const n of r.nodes) {
    if (!n?.id || n.displayFinancialStatus !== 'PAID') continue
    const when = (n.transactions ?? [])
      .filter((t) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS' && t.processedAt)
      .map((t) => t.processedAt!)
      .sort()
      .pop()
    const s = open.find((x) => x.shopifyOrderId === n.id)
    if (s) await db.wholesaleShipment.update({ where: { id: s.id }, data: { paid: true, paidAt: when ? new Date(when) : new Date() } })
  }
}
