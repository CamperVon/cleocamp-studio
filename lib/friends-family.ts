/**
 * Friends and Family: 20% off (Brandon, 28 Sept 2026). One number, here, so
 * nothing works it out by hand. On 28 Sept Mouse took 20% off $398 for a
 * bean bag Shopify sells at $368, and #2643 went out $24 too high.
 *
 *   - An invoice Mouse makes: Shopify applies FRIENDS_AND_FAMILY as a named
 *     discount on its own prices (lib/live-sale.ts, `discount`).
 *   - A web order already paid: refund 20% of what was paid for the goods,
 *     and the tax on them. Shipping is not part of the discount.
 *
 * The customer is told in fixed text, never a model's words (CLAUDE.md §4),
 * signed as Cleo Studio from support@ like every other customer email.
 */
import { shopifyGraphQL } from '@/lib/integrations/shopify'

export const FRIENDS_AND_FAMILY = { percent: 20, title: 'Friends and Family' } as const

const round2 = (n: number) => Math.round(n * 100) / 100

/** 20% of the goods and of the tax on them. Pure. */
export function friendsFamilyRefund(goods: number, goodsTax: number): number {
  return round2((goods + goodsTax) * FRIENDS_AND_FAMILY.percent / 100)
}

/** What the customer is sent once the refund is made. Fixed text. Pure. */
export function friendsFamilyText(firstName: string | null, orderName: string, amount: number): string {
  return `Hi ${firstName ?? 'there'},\n\nAs a friend of Cleo Camp, your order ${orderName} gets our Friends and Family discount of 20%. We've refunded $${amount.toFixed(2)} to your original payment. It can take a few days to show on your statement.\n\nKindly,\nCleo Studio`
}

type Money = { shopMoney: { amount: string } }
const money = (m: Money | null | undefined) => Number(m?.shopMoney.amount ?? 0)

export type FFOrder = {
  id: string
  name: string
  email: string | null
  firstName: string | null
  goods: number
  goodsTax: number
  refund: number
  /** Why it cannot be done here, in words for the person; null when it can. */
  blocked: string | null
  gateway: string | null
  parentId: string | null
}

/** Read a paid web order and work out its Friends and Family refund. Changes nothing. */
export async function friendsFamilyOrder(orderName: string): Promise<FFOrder | null> {
  const name = `#${orderName.replace(/^#/, '').trim()}`
  const d = await shopifyGraphQL<{ orders: { nodes: Array<{
    id: string; name: string; email: string | null; cancelledAt: string | null; displayFinancialStatus: string | null
    billingAddress: { firstName: string | null } | null; shippingAddress: { firstName: string | null } | null
    currentSubtotalPriceSet: Money; totalDiscountsSet: Money; totalRefundedSet: Money
    lineItems: { nodes: Array<{ taxLines: Array<{ priceSet: Money }> }> }
    transactions: Array<{ id: string; kind: string; status: string; gateway: string; amountSet: Money }>
  }> } }>(
    `query($q: String!) { orders(first: 5, query: $q) { nodes {
      id name email cancelledAt displayFinancialStatus billingAddress { firstName } shippingAddress { firstName }
      currentSubtotalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } }
      lineItems(first: 50) { nodes { taxLines { priceSet { shopMoney { amount } } } } }
      transactions(first: 20) { id kind status gateway amountSet { shopMoney { amount } } }
    } } }`,
    { q: `name:${name}` },
  )
  const o = d.orders.nodes.find((n) => n.name === name)
  if (!o) return null
  const goods = money(o.currentSubtotalPriceSet)
  const goodsTax = round2(o.lineItems.nodes.reduce((n, l) => n + l.taxLines.reduce((m, t) => m + money(t.priceSet), 0), 0))
  const paid = o.transactions.filter((t) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS')
  let blocked: string | null = null
  if (o.cancelledAt) blocked = `${o.name} is cancelled.`
  else if (o.displayFinancialStatus !== 'PAID') blocked = `${o.name} is ${String(o.displayFinancialStatus ?? 'not paid').toLowerCase().replace(/_/g, ' ')}, not paid in full, so there is nothing to take 20% back from yet.`
  else if (money(o.totalRefundedSet) > 0) blocked = `${o.name} already has a refund on it. Do this one in Shopify so nothing is refunded twice.`
  else if (money(o.totalDiscountsSet) > 0) blocked = `${o.name} already has a discount on it. Ask whether Friends and Family should still apply on top.`
  else if (paid.length !== 1) blocked = `${o.name} was paid in more than one way, so the refund has to be split by hand in Shopify.`
  return {
    id: o.id, name: o.name, email: o.email,
    // From the order's own addresses, not the customer record: the app is not
    // granted read_customers, and asking for it failed #2642 (28 Sept 2026).
    firstName: o.billingAddress?.firstName ?? o.shippingAddress?.firstName ?? null,
    goods, goodsTax, refund: friendsFamilyRefund(goods, goodsTax), blocked,
    gateway: paid[0]?.gateway ?? null, parentId: paid[0]?.id ?? null,
  }
}

/**
 * Refund it. The idempotency key is the order, so a second tap is the same
 * refund to Shopify and cannot pay out twice. Nothing is restocked: the
 * customer keeps the goods.
 */
export async function refundFriendsFamily(o: FFOrder): Promise<void> {
  if (o.blocked || !o.gateway || !o.parentId) throw new Error(o.blocked ?? 'No payment to refund against.')
  const r = await shopifyGraphQL<{ refundCreate: { refund: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: RefundInput!, $key: String!) { refundCreate(input: $input) @idempotent(key: $key) { refund { id } userErrors { message } } }`,
    {
      key: `friends-family-${o.id.split('/').pop()}`,
      input: {
        orderId: o.id, notify: false, note: 'Friends and Family, 20%. Refunded from Studio Mouse.',
        transactions: [{ orderId: o.id, gateway: o.gateway, kind: 'REFUND', amount: o.refund.toFixed(2), parentId: o.parentId }],
      },
    },
  )
  if (!r.refundCreate.refund) throw new Error(r.refundCreate.userErrors.map((e) => e.message).join('; ') || 'Shopify did not create the refund.')
}
