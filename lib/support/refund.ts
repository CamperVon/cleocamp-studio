/**
 * Refunding an order that has already shipped, in full, when the team says
 * so on a support case. Brandon, 29 Sept 2026, on #2104 (a white tee ordered,
 * a black one sent to Berlin): "I would tell mouse to go ahead and refund her."
 *
 * Shopify works out the money, never us (CLAUDE.md §6): its suggested refund
 * with every item, the shipping and any import duty, which is everything
 * still refundable on the order. Nothing is restocked: the goods are with
 * the customer. If they come back, the Return arrived box logs them.
 *
 * Only ever called from a person's tap in the app (money needs one, §4).
 */
import { shopifyGraphQL } from '@/lib/integrations/shopify'

type Money = { shopMoney: { amount: string } }
type Full = {
  amount: number
  lines: Array<{ lineItemId: string; quantity: number }>
  duties: string[]
  transactions: Array<{ gateway: string; parentId: string | null; amount: number }>
}

async function suggestFull(orderId: string): Promise<Full> {
  const o = await shopifyGraphQL<{ order: { lineItems: { nodes: Array<{ duties: Array<{ id: string }> }> } } | null }>(
    `query($id: ID!) { order(id: $id) { lineItems(first: 50) { nodes { duties { id } } } } }`,
    { id: orderId },
  )
  if (!o.order) throw new Error('Shopify has no such order.')
  const duties = o.order.lineItems.nodes.flatMap((l) => l.duties.map((d) => d.id))
  const d = await shopifyGraphQL<{ order: { suggestedRefund: {
    amountSet: Money
    refundLineItems: Array<{ lineItem: { id: string }; quantity: number }>
    suggestedTransactions: Array<{ gateway: string; parentTransaction: { id: string } | null; amountSet: Money }>
  } | null } | null }>(
    `query($id: ID!, $duties: [RefundDutyInput!]) { order(id: $id) {
      suggestedRefund(suggestFullRefund: true, refundShipping: true, refundDuties: $duties) {
        amountSet { shopMoney { amount } }
        refundLineItems { lineItem { id } quantity }
        suggestedTransactions { gateway parentTransaction { id } amountSet { shopMoney { amount } } } } } }`,
    { id: orderId, duties: duties.map((dutyId) => ({ dutyId, refundType: 'FULL' })) },
  )
  const s = d.order?.suggestedRefund
  if (!s) throw new Error('Shopify could not work out a refund for this order.')
  return {
    amount: Number(s.amountSet.shopMoney.amount),
    lines: s.refundLineItems.map((l) => ({ lineItemId: l.lineItem.id, quantity: l.quantity })),
    duties,
    transactions: s.suggestedTransactions
      .map((t) => ({ gateway: t.gateway, parentId: t.parentTransaction?.id ?? null, amount: Number(t.amountSet.shopMoney.amount) }))
      .filter((t) => t.amount > 0),
  }
}

/** What refunding the order in full would pay back, from Shopify. Changes nothing. */
export async function quoteFullRefund(orderId: string): Promise<number> {
  return (await suggestFull(orderId)).amount
}

/**
 * Refund everything still refundable, if Shopify's figure is still the one
 * the person was shown. The idempotency key is the order and the case, so a
 * second tap is the same refund and cannot pay out twice.
 */
export async function refundInFull(orderId: string, expected: number, key: string, note: string): Promise<number> {
  const s = await suggestFull(orderId)
  if (s.amount <= 0) throw new Error('Nothing is left to refund on this order.')
  if (Math.abs(s.amount - expected) > 0.005) {
    throw new Error(`Shopify now says $${s.amount.toFixed(2)}, not the $${expected.toFixed(2)} you were shown. Tap again to see the new figure.`)
  }
  if (s.transactions.length !== 1 || !s.transactions[0].parentId) {
    throw new Error('This order was paid in more than one way, so the refund has to be split by hand in Shopify.')
  }
  const t = s.transactions[0]
  const r = await shopifyGraphQL<{ refundCreate: { refund: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: RefundInput!, $key: String!) { refundCreate(input: $input) @idempotent(key: $key) { refund { id } userErrors { message } } }`,
    {
      key,
      input: {
        orderId, note: note.slice(0, 250), notify: false,
        refundLineItems: s.lines.map((l) => ({ ...l, restockType: 'NO_RESTOCK' })),
        shipping: { fullRefund: true },
        refundDuties: s.duties.map((dutyId) => ({ dutyId, refundType: 'FULL' })),
        transactions: [{ orderId, gateway: t.gateway, kind: 'REFUND', amount: t.amount.toFixed(2), parentId: t.parentId }],
      },
    },
  )
  if (!r.refundCreate.refund) throw new Error(r.refundCreate.userErrors.map((e) => e.message).join('; ') || 'Shopify did not create the refund.')
  return t.amount
}
