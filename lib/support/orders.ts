import { namesMatch } from '@/lib/support/core'
import { refundIssued } from '@/lib/support/reply'
import { isConfigured, shopifyGraphQL } from '@/lib/integrations/shopify'

/**
 * The customer's order, found by code — never chosen by the model reading the
 * email. By an order number quoted in the email first (exact), then by the
 * sender's address (most recent). An order quoted from a different address is
 * kept and marked (emailMismatch), and treated as theirs when the name on it
 * matches the sender (sameName).
 */
export type OrderSnapshot = {
  id: string
  name: string
  createdAt: string
  financialStatus: string | null
  fulfillmentStatus: string | null
  /** When Shopify cancelled it, if it has. Absent on snapshots from before 25 Sept 2026. */
  cancelledAt?: string | null
  total: string | null
  email: string | null
  /** id/unfulfilled/variantId are absent on snapshots from before 24 Sept 2026, current before 26 Sept. */
  items: Array<{ title: string; variant: string | null; quantity: number; id?: string; unfulfilled?: number; variantId?: string | null; current?: number }>
  /**
   * Money refunded or on its way back, in the order's currency: refund
   * transactions that succeeded or are pending. A Shopify Payments refund
   * sits pending for a while and the order reads "paid" until it settles —
   * on 25 Sept 2026 #2555 was cancelled and $95 refunded, and the check that
   * waited for the word "refunded" gave up and sent nothing. Absent on
   * snapshots from before 26 Sept 2026.
   */
  refunded?: number
  /** The billing name, a second name to match a customer writing from another address. */
  billName?: string | null
  tracking: Array<{ company: string | null; number: string | null; url: string | null }>
  /** Where it is going. Optional: snapshots taken before 24 Sept 2026 lack it. */
  shipTo?: ShipTo | null
  /**
   * Set when this order was found by the number the customer quoted but was
   * placed with a different email: the order's own email. The team sees the
   * order; the drafter is told only that it exists; nothing can change it.
   */
  emailMismatch?: string | null
  /**
   * On a mismatch: the name on the order matches the person writing in (see
   * namesMatch), so it is treated as theirs. Brandon, 25 Sept 2026: "people
   * often email with a different email address." Address changes still need
   * the order's own email; a cancel's refund can only go back to the card
   * that paid, so a name match is enough for that.
   */
  sameName?: boolean
}

export type ShipTo = {
  name: string | null; address1: string | null; address2: string | null
  city: string | null; provinceCode: string | null; zip: string | null; countryCode: string | null
}

type Node = {
  id: string
  name: string
  createdAt: string
  cancelledAt?: string | null
  email: string | null
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string | null
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null
  lineItems: { nodes: Array<{ id: string; title: string; variantTitle: string | null; quantity: number; currentQuantity: number; unfulfilledQuantity: number; variant: { id: string } | null }> }
  transactions?: Array<{ kind: string; status: string; amountSet: { shopMoney: { amount: string } } }>
  billingAddress?: { name: string | null } | null
  fulfillments: Array<{ trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }> }>
  shippingAddress: (Omit<ShipTo, 'countryCode'> & { countryCodeV2: string | null }) | null
}

const ORDER_FIELDS = `
  id name createdAt cancelledAt email displayFinancialStatus displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 20) { nodes { id title variantTitle quantity currentQuantity unfulfilledQuantity variant { id } } }
  transactions(first: 30) { kind status amountSet { shopMoney { amount } } }
  billingAddress { name }
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
    cancelledAt: n.cancelledAt ?? null,
    total: n.totalPriceSet ? `${n.totalPriceSet.shopMoney.amount} ${n.totalPriceSet.shopMoney.currencyCode}` : null,
    email: n.email,
    items: n.lineItems.nodes.map((l) => ({
      title: l.title, variant: l.variantTitle, quantity: l.quantity,
      id: l.id, unfulfilled: l.unfulfilledQuantity, variantId: l.variant?.id ?? null, current: l.currentQuantity,
    })),
    refunded: Math.round((n.transactions ?? [])
      .filter((t) => t.kind === 'REFUND' && (t.status === 'SUCCESS' || t.status === 'PENDING'))
      .reduce((a, t) => a + Number(t.amountSet.shopMoney.amount), 0) * 100) / 100,
    billName: n.billingAddress?.name ?? null,
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

export async function findOrder(email: string, quotedNames: string[], senderName?: string | null): Promise<
  { order: OrderSnapshot | null; recent: OrderSnapshot[]; note: string | null }
> {
  if (!isConfigured()) return { order: null, recent: [], note: 'Shopify is not connected' }
  try {
    // An order number alone could be anyone's, so it is only trusted when the
    // address matches too. But it is not thrown away when it doesn't: on
    // 25 Sept 2026 Serena quoted #2355, which she had placed from another
    // address, and the case said no order existed, so the draft asked her
    // for the number she had just given. Now the order is kept, marked, and
    // the team decides. Anything that changes an order still checks the
    // sender against the order's email at the tap, so nothing opens up.
    let claimed: OrderSnapshot | null = null
    for (const name of quotedNames) {
      const [hit] = await search(`name:${name}`, 1)
      if (hit && (!hit.email || hit.email.toLowerCase() === email)) {
        return { order: hit, recent: [], note: null }
      }
      if (hit && !claimed) {
        claimed = { ...hit, emailMismatch: hit.email, sameName: namesMatch(senderName, email, [hit.shipTo?.name, hit.billName]) }
      }
    }
    const recent = await search(`email:${email}`, 3)
    const mismatchNote = claimed
      ? claimed.sameName
        ? `${claimed.name} was placed with ${claimed.emailMismatch}, not ${email}, but the name matches, so it is treated as theirs. An address change still needs a message from the order's email.`
        : `${claimed.name} was placed with ${claimed.emailMismatch}, not ${email}, and the name does not match. Shown so you can judge whether it is theirs; changes to it stay locked.`
      : null
    // The order they named, when it is plainly theirs, beats their latest one.
    if (claimed?.sameName) return { order: claimed, recent, note: mismatchNote }
    if (recent.length) return { order: recent[0], recent, note: mismatchNote }
    if (claimed) return { order: claimed, recent: [], note: mismatchNote }
    return {
      order: null,
      recent,
      note: `No Shopify order under ${email}${quotedNames.length ? ` or ${quotedNames.join(', ')}` : ''}`,
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

/**
 * Take the not-yet-shipped units of one line off an order, back into stock.
 *
 * Shopify will not cancel part of an order once any of it has shipped — which
 * is what cost Brandon fifteen minutes on #2423, 24 Sept 2026 — but an order
 * EDIT can remove unfulfilled units, and that is what takes the item off the
 * packing list. Refunding alone leaves it there. The refund itself is not
 * sent here: money is a person's tap in Shopify (CLAUDE.md §4).
 * Needs write_order_edits.
 */
export async function removeUnshippedUnits(
  orderId: string, lineItemId: string, variantId: string | null, staffNote: string,
): Promise<{ ok: true; removed: number; refundOwed: string | null } | { ok: false; error: string }> {
  type Calc = { id: string; title: string; variantTitle: string | null; quantity: number; editableQuantity: number; variant: { id: string } | null }
  const begin = await shopifyGraphQL<{ orderEditBegin: { calculatedOrder: { id: string; lineItems: { nodes: Calc[] } } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id lineItems(first: 50) { nodes { id title variantTitle quantity editableQuantity variant { id } } } } userErrors { field message } } }`,
    { id: orderId },
  )
  const calc = begin.orderEditBegin.calculatedOrder
  if (!calc || begin.orderEditBegin.userErrors.length) {
    return { ok: false, error: begin.orderEditBegin.userErrors.map((e) => e.message).join('; ') || 'Shopify would not open the order for editing.' }
  }
  const line = matchCalculatedLine(lineItemId, variantId, calc.lineItems.nodes)
  if (!line) return { ok: false, error: 'Could not find that item in the order edit — do it in Shopify (Edit order).' }
  if (line.editableQuantity < 1) return { ok: false, error: 'Nothing unshipped left on that item.' }

  const set = await shopifyGraphQL<{ orderEditSetQuantity: { userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!, $lineItemId: ID!, $quantity: Int!) { orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: true) { calculatedLineItem { id quantity } userErrors { field message } } }`,
    { id: calc.id, lineItemId: line.id, quantity: line.quantity - line.editableQuantity },
  )
  if (set.orderEditSetQuantity.userErrors.length) {
    return { ok: false, error: set.orderEditSetQuantity.userErrors.map((e) => e.message).join('; ') }
  }
  const commit = await shopifyGraphQL<{ orderEditCommit: { order: { totalOutstandingSet: { shopMoney: { amount: string; currencyCode: string } } } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($id: ID!, $note: String) { orderEditCommit(id: $id, notifyCustomer: false, staffNote: $note) { order { id totalOutstandingSet { shopMoney { amount currencyCode } } } userErrors { field message } } }`,
    { id: calc.id, note: staffNote.slice(0, 250) },
  )
  if (commit.orderEditCommit.userErrors.length) {
    return { ok: false, error: commit.orderEditCommit.userErrors.map((e) => e.message).join('; ') }
  }
  const out = commit.orderEditCommit.order?.totalOutstandingSet.shopMoney
  // Outstanding goes negative when the customer has paid for more than the
  // order now holds: that is the refund owed.
  const owed = out && Number(out.amount) < 0 ? `${Math.abs(Number(out.amount)).toFixed(2)} ${out.currencyCode}` : null
  return { ok: true, removed: line.editableQuantity, refundOwed: owed }
}

/**
 * The edit's copy of a line. Shopify gives the edit its own ids; the number
 * at the end usually matches the order's line, so that is tried first, then
 * the variant — but only if exactly one editable line has it, never a guess.
 */
export function matchCalculatedLine<T extends { id: string; editableQuantity: number; variant: { id: string } | null }>(
  lineItemId: string, variantId: string | null, lines: T[],
): T | null {
  const num = (gid: string) => gid.split('/').pop()
  const byId = lines.find((l) => num(l.id) === num(lineItemId))
  if (byId) return byId
  if (!variantId) return null
  const byVariant = lines.filter((l) => l.variant?.id === variantId && l.editableQuantity > 0)
  return byVariant.length === 1 ? byVariant[0] : null
}

/**
 * Cancel the whole order in Shopify, refund it to the original payment and
 * restock it. For a customer who asks to cancel before anything has shipped.
 *
 * 25 Sept 2026: a draft to MacKenzie said order #2555 had been cancelled and
 * refunded, and Send only sent the email. Brandon: "mouse should do this on
 * its own." So the tap that sends the reply does the cancellation first. It
 * moves money, which is why it only ever runs on a person's tap in the app
 * (CLAUDE.md §4), never from an email and never by a model.
 *
 * Shopify cancels in the background. The order is read again until it shows
 * as cancelled, so the reply only goes once it is true. Needs write_orders.
 */
export async function cancelAndRefund(orderId: string, staffNote: string): Promise<
  { ok: true; order: OrderSnapshot } | { ok: false; error: string }
> {
  const r = await shopifyGraphQL<{ orderCancel: { job: { id: string; done: boolean } | null; orderCancelUserErrors: Array<{ message: string }> } }>(
    `mutation($orderId: ID!, $note: String) { orderCancel(orderId: $orderId, reason: CUSTOMER, refundMethod: { originalPaymentMethodsRefund: true }, restock: true, notifyCustomer: false, staffNote: $note) { job { id done } orderCancelUserErrors { field message code } } }`,
    { orderId, note: staffNote.slice(0, 250) },
  )
  if (r.orderCancel.orderCancelUserErrors.length) {
    return { ok: false, error: r.orderCancel.orderCancelUserErrors.map((e) => e.message).join('; ') }
  }
  let now: OrderSnapshot | null = null
  for (let i = 0; i < 8; i++) {
    now = await freshOrder(orderId)
    if (now?.cancelledAt && refundIssued(now)) return { ok: true, order: now }
    await new Promise((res) => setTimeout(res, 1000))
  }
  return {
    ok: false,
    error: now?.cancelledAt
      ? 'Shopify cancelled the order but shows no refund on it yet. Check the order in Shopify before sending anything.'
      : 'Shopify accepted the cancellation but had not cancelled the order after 8 seconds. Check it in Shopify before sending anything.',
  }
}

/**
 * Cancel what has not shipped on a part-shipped order and refund it, in one
 * step. For a customer whose order is partly out the door: the shipped part
 * is a return, the rest is cancelled.
 *
 * 25 Sept 2026, Elisabeth, #2237: one tee shipped, one not. The draft said the
 * unshipped one was "cancelled and refunded in full". The whole-order cancel
 * rightly refused, and the per-item "Remove" took the item off but left the
 * refund for a person to send in Shopify, so the reply would still not have
 * been true. Now one tap does both.
 *
 * Shopify's own suggested refund works out the amount (the item plus its
 * tax), and the refund cancels the unshipped quantity (restock type CANCEL)
 * in the same call. The order is read again afterwards and the result checked:
 * those units no longer waiting to ship, and the order showing a refund.
 * Only ever run on a person's tap (CLAUDE.md §4). Needs write_orders.
 */
export async function cancelUnshippedLines(
  orderId: string,
  lines: Array<{ lineItemId: string; quantity: number }>,
  locationId: string,
  note: string,
): Promise<{ ok: true; refunded: string; order: OrderSnapshot } | { ok: false; error: string }> {
  const refundLineItems = lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity, restockType: 'CANCEL', locationId }))
  type Tx = { gateway: string; kind: string; parentTransaction: { id: string } | null; amountSet: { shopMoney: { amount: string; currencyCode: string } } }
  const s = await shopifyGraphQL<{ order: { suggestedRefund: { amountSet: { shopMoney: { amount: string; currencyCode: string } }; suggestedTransactions: Tx[] } | null } | null }>(
    `query($id: ID!, $lines: [RefundLineItemInput!]) { order(id: $id) { suggestedRefund(refundLineItems: $lines, suggestFullRefund: false) { amountSet { shopMoney { amount currencyCode } } suggestedTransactions { gateway kind parentTransaction { id } amountSet { shopMoney { amount currencyCode } } } } } }`,
    { id: orderId, lines: refundLineItems },
  )
  const sug = s.order?.suggestedRefund
  if (!sug) return { ok: false, error: 'Shopify could not work out a refund for those items.' }
  const transactions = sug.suggestedTransactions
    .filter((t) => Number(t.amountSet.shopMoney.amount) > 0)
    .map((t) => ({ orderId, gateway: t.gateway, kind: 'REFUND', amount: t.amountSet.shopMoney.amount, parentId: t.parentTransaction?.id ?? null }))
  if (Number(sug.amountSet.shopMoney.amount) > 0 && !transactions.length) {
    return { ok: false, error: 'Shopify suggested a refund but no payment to refund it to. Do it in Shopify.' }
  }

  const before = await freshOrder(orderId)
  // Shopify has required an idempotency key on refunds since API 2026-04;
  // without one the call is refused (#2237, 25 Sept 2026). The key is the
  // order and the exact units, never random, so a second tap on the same
  // cancel is the same refund to Shopify and cannot pay out twice.
  const key = `cancel-unshipped-${orderId.split('/').pop()}-${lines.map((l) => `${l.lineItemId.split('/').pop()}x${l.quantity}`).sort().join('-')}`
  const r = await shopifyGraphQL<{ refundCreate: { refund: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    `mutation($input: RefundInput!, $key: String!) { refundCreate(input: $input) @idempotent(key: $key) { refund { id totalRefundedSet { shopMoney { amount currencyCode } } } userErrors { field message } } }`,
    { input: { orderId, note: note.slice(0, 250), notify: false, refundLineItems, transactions }, key },
  )
  if (r.refundCreate.userErrors.length || !r.refundCreate.refund) {
    return { ok: false, error: r.refundCreate.userErrors.map((e) => e.message).join('; ') || 'Shopify did not create the refund.' }
  }

  // A pending refund counts: see OrderSnapshot.refunded.
  const after = await freshOrder(orderId)
  if (!after) return { ok: false, error: 'The refund was created but the order could not be read back. Check it in Shopify before sending anything.' }
  const stillOn = lines.filter((l) => {
    const was = before?.items.find((i) => i.id === l.lineItemId)?.current
    const now = after.items.find((i) => i.id === l.lineItemId)?.current
    return was === undefined || now === undefined || now > was - l.quantity
  })
  if (stillOn.length || (Number(sug.amountSet.shopMoney.amount) > 0 && (after.refunded ?? 0) <= (before?.refunded ?? 0))) {
    return { ok: false, error: 'The refund was created but the order does not yet show those items cancelled and refunded. Check it in Shopify before sending anything.' }
  }
  const amt = sug.amountSet.shopMoney
  return { ok: true, refunded: `${Number(amt.amount).toFixed(2)} ${amt.currencyCode}`, order: after }
}
