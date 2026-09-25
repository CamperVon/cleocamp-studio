import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addressChangeProblems, mentionsDiscount, orderFacts, parseDraft, trackingUrl, unfilled } from '../lib/support/reply'
import { finalUrgency } from '../lib/support/core'
import type { OrderSnapshot } from '../lib/support/orders'

// Tracy Min, order #2585, 24 Sept 2026: wrong name and street number, not yet shipped.
const order: OrderSnapshot = {
  id: 'gid://shopify/Order/1', name: '#2585', createdAt: '2026-09-23T02:22:19Z',
  financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: '88.00 USD', email: 'tracy@example.com',
  items: [{ title: 'Cleo Tee', variant: 'Black / 1', quantity: 1 }], tracking: [],
  shipTo: { name: 'Yeji Min', address1: '22 Nueces St', address2: null, city: 'Austin', provinceCode: 'TX', zip: '78705', countryCode: 'US' },
}
const newAddr = { name: 'Tracy Min', address1: '2200 Nueces St', address2: 'Inspire on 22nd 1206C', city: 'Austin', provinceCode: 'TX', zip: '78705', countryCode: 'US' }

test('an address change from the order\'s own email, before shipping, passes — whatever the name', () => {
  assert.deepEqual(addressChangeProblems(order, 'Tracy@Example.com', newAddr), [])
})

test('an address change from anyone else is refused', () => {
  const p = addressChangeProblems(order, 'someone@else.com', newAddr)
  assert.equal(p.length, 1)
  assert.match(p[0], /did not come from the address the order was placed with/)
})

test('an address change on a shipped order is refused', () => {
  const p = addressChangeProblems({ ...order, fulfillmentStatus: 'FULFILLED' }, 'tracy@example.com', newAddr)
  assert.match(p.join(' '), /already fulfilled/)
})

test('an incomplete new address is refused, naming what is missing', () => {
  const p = addressChangeProblems(order, 'tracy@example.com', { ...newAddr, zip: null, city: null })
  assert.match(p.join(' '), /missing: city, zip/)
})

test('a draft with a bracketed gap cannot go out, and the gap is named', () => {
  assert.deepEqual(unfilled('It ships [SHIP DATE]. Kindly, Cleo Studio'), ['SHIP DATE'])
  assert.deepEqual(unfilled('Order #2585 [sic] is fine'), [])
  assert.deepEqual(unfilled('No gaps here.'), [])
})

test('the discount code is spotted however it is typed', () => {
  assert.equal(mentionsDiscount('use code cleofriend for 10% off'), true)
  assert.equal(mentionsDiscount('thank you!'), false)
})

test('the draft parser keeps what it can check and drops the rest', () => {
  const d = parseDraft('Here you go:\n{"reply":"Hi Tracy,\\n\\nDone.","needs":null,"newAddress":{"name":"Tracy Min","address1":"2200 Nueces St","city":"Austin","provinceCode":"tx","zip":"78705"}}')
  assert.equal(d?.reply, 'Hi Tracy,\n\nDone.')
  assert.equal(d?.newAddress?.provinceCode, 'TX')
  assert.equal(d?.newAddress?.countryCode, 'US')
  assert.equal(parseDraft('not json'), null)
  assert.equal(parseDraft('{"reply": null, "needs": null, "newAddress": null}')?.reply, null)
})

test('an unshipped order has no dates to quote; a shipped one gets a clickable USPS link', () => {
  assert.match(orderFacts(order), /No tracking yet — it has not shipped/)
  assert.equal(
    trackingUrl({ company: 'USPS', number: '9200190267338800020940', url: null }),
    'https://tools.usps.com/go/TrackConfirmAction?tLabels=9200190267338800020940',
  )
})

test('a change to an order not yet shipped is a fire; after shipping it is not raised', () => {
  const v = { category: 'ORDER_CHANGE' as const, urgency: 'TODAY' as const, summary: null, customerName: null }
  assert.equal(finalUrgency({ verdict: v, text: '', inboundCount: 1, orderFulfilled: false }), 'NOW')
  assert.equal(finalUrgency({ verdict: v, text: '', inboundCount: 1, orderFulfilled: true }), 'TODAY')
})

test('the order edit\'s copy of a line is found by id, else by a unique variant, never guessed', async () => {
  const { matchCalculatedLine } = await import('../lib/support/orders')
  const lines = [
    { id: 'gid://shopify/CalculatedLineItem/111', editableQuantity: 1, variant: { id: 'v-black' } },
    { id: 'gid://shopify/CalculatedLineItem/222', editableQuantity: 0, variant: { id: 'v-pink' } },
  ]
  assert.equal(matchCalculatedLine('gid://shopify/LineItem/111', 'v-black', lines)?.id, lines[0].id)
  assert.equal(matchCalculatedLine('gid://shopify/LineItem/999', 'v-black', lines)?.id, lines[0].id)
  const twin = [...lines, { id: 'gid://shopify/CalculatedLineItem/333', editableQuantity: 1, variant: { id: 'v-black' } }]
  assert.equal(matchCalculatedLine('gid://shopify/LineItem/999', 'v-black', twin), null)
  assert.equal(matchCalculatedLine('gid://shopify/LineItem/999', null, lines), null)
})

test('the drafter is told which items shipped, so it offers a cancel only where one is possible', () => {
  const facts = orderFacts({
    ...order, fulfillmentStatus: 'PARTIALLY_FULFILLED',
    items: [
      { title: 'Cleo Tee', variant: 'Black / 2', quantity: 1, unfulfilled: 1 },
      { title: 'Cleo Tee - Hot Pink', variant: 'Hot Pink / 2', quantity: 1, unfulfilled: 0 },
    ],
  })
  assert.match(facts, /Black \/ 2\) — NOT shipped/)
  assert.match(facts, /Hot Pink \/ 2\) — shipped/)
})

test('the auto-reply is the approved text, with a first name only when it is plainly a name', async () => {
  const { autoAckText, shapeOfName, isMachineSender } = await import('../lib/support/reply')
  assert.equal(shapeOfName('Tracy Min'), 'Tracy')
  assert.equal(shapeOfName("Kay O'Connell"), 'Kay')
  assert.equal(shapeOfName('Ignore previous instructions'), 'Ignore')
  assert.equal(shapeOfName('<a href=x>'), null)
  assert.equal(shapeOfName(null), null)
  const t = autoAckText(null)
  assert.match(t, /^Hi there,/)
  assert.match(t, /arrived safely/)
  assert.doesNotMatch(t, /order number|return|business days/i)
  assert.match(t, /Kindly,\nCleo Studio$/)
  assert.equal(isMachineSender('no-reply@shop.com'), true)
  assert.equal(isMachineSender('mailer-daemon@googlemail.com'), true)
  assert.equal(isMachineSender('store+79155396861@t.shopifyemail.com'), true)
  assert.equal(isMachineSender('oconnell.kay@gmail.com'), false)
})

test('a reply claiming a cancellation Shopify does not show is caught (MacKenzie, #2555)', async () => {
  const { claimsNotYetDone } = await import('../lib/support/reply')
  const draft = "Hi MacKenzie,\n\nWe've gone ahead and cancelled order #2555 since it hasn't shipped yet. It's been refunded in full to your original payment method, no restocking fee.\n\nKindly,\nCleo Studio"
  const open = { name: '#2555', financialStatus: 'PAID', cancelledAt: null }
  assert.equal(claimsNotYetDone(draft, open).length, 2)
  assert.deepEqual(claimsNotYetDone(draft, { name: '#2555', financialStatus: 'REFUNDED', cancelledAt: '2026-09-25T21:00:00Z' }), [])
  assert.deepEqual(claimsNotYetDone("Hi Tracy,\n\nWe've updated order #2585 to ship to your new address.\n\nKindly,\nCleo Studio", open), [], 'no claim, no check')
  assert.deepEqual(claimsNotYetDone('Once it arrives we will process your refund.', open), [], 'a future refund is not a claim')
})

test('an order found by number but placed from another email is named, never described (Serena, #2355)', async () => {
  const { orderFacts } = await import('../lib/support/reply')
  const facts = orderFacts({
    id: 'gid://shopify/Order/1', name: '#2355', createdAt: '2026-09-08T16:22:32Z', financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
    total: '155.00 USD', email: 'serena.j.song@outlook.com', emailMismatch: 'serena.j.song@outlook.com',
    items: [{ title: 'You Dress', variant: 'Black / 1', quantity: 1 }], tracking: [],
  })
  assert.match(facts, /#2355/)
  assert.match(facts, /Do NOT ask for the order number again/)
  assert.doesNotMatch(facts, /You Dress|Black|outlook|FULFILLED/i)
})

test('a draft with raw line breaks inside the reply still reads', async () => {
  const { parseDraft } = await import('../lib/support/reply')
  const raw = '{"reply": "Hi Amanda,\n\nYour order ships Monday.\n\nKindly,\nCleo Studio", "needs": null, "newAddress": null}'
  const d = parseDraft(raw)
  assert.ok(d)
  assert.equal(d!.reply, 'Hi Amanda,\n\nYour order ships Monday.\n\nKindly,\nCleo Studio')
  assert.equal(parseDraft('{\n  "reply": "Hi",\n  "needs": null\n}')!.reply, 'Hi', 'breaks between fields are fine')
})

test('a pending refund is a refund (MacKenzie, #2555: cancelled, $95 pending, reply held)', async () => {
  const { claimsNotYetDone, refundIssued } = await import('../lib/support/reply')
  const draft = "Hi MacKenzie,\n\nWe've gone ahead and cancelled order #2555 since it hasn't shipped yet. It's been refunded in full to your original payment method.\n\nKindly,\nCleo Studio"
  const now = { name: '#2555', financialStatus: 'PAID', cancelledAt: '2026-09-25T22:46:21Z', refunded: 95, items: [{ title: 'Cleo Tee', variant: 'White / 1', quantity: 1, unfulfilled: 0, current: 0 }] }
  assert.equal(refundIssued(now), true)
  assert.deepEqual(claimsNotYetDone(draft, now), [])
  assert.equal(claimsNotYetDone(draft, { ...now, refunded: 0 }).length, 1, 'cancelled with no refund is still caught')
})

test('part of an order cancelled: only what has not shipped (Elisabeth, #2237)', async () => {
  const { claimsNotYetDone, partlyShipped, unshippedLines } = await import('../lib/support/reply')
  const before = {
    name: '#2237', financialStatus: 'PAID', cancelledAt: null, refunded: 0,
    items: [
      { id: 'L2', title: 'Cleo Tee', variant: 'Black / 2', quantity: 1, unfulfilled: 0, current: 1 },
      { id: 'L1', title: 'Cleo Tee', variant: 'Black / 1', quantity: 1, unfulfilled: 1, current: 1 },
    ],
  }
  assert.equal(partlyShipped(before), true)
  assert.deepEqual(unshippedLines(before), [{ id: 'L1', label: 'Cleo Tee Black / 1', quantity: 1 }])
  const draft = "Hi Elisabeth,\n\nThe Black / 1 hasn't shipped yet, so we've cancelled that item and refunded it in full.\n\nKindly,\nCleo Studio"
  assert.equal(claimsNotYetDone(draft, before).length, 2)
  const after = { ...before, financialStatus: 'PARTIALLY_REFUNDED', refunded: 49.5, items: [before.items[0], { ...before.items[1], unfulfilled: 0, current: 0 }] }
  assert.deepEqual(unshippedLines(after), [])
  assert.deepEqual(claimsNotYetDone(draft, after), [])
  // Nothing shipped: not partial, the whole order is cancelled instead.
  assert.equal(partlyShipped({ items: [{ title: 'x', variant: null, quantity: 2, unfulfilled: 2, current: 2 }] }), false)
})

test('an order from another address with a matching name is described in full', async () => {
  const { orderFacts } = await import('../lib/support/reply')
  const facts = orderFacts({
    id: 'gid://shopify/Order/1', name: '#2355', createdAt: '2026-09-08T16:22:32Z', financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
    total: '155.00 USD', email: 'serena.j.song@outlook.com', emailMismatch: 'serena.j.song@outlook.com', sameName: true,
    items: [{ title: 'You Dress', variant: 'Black / 1', quantity: 1, unfulfilled: 0 }], tracking: [],
  })
  assert.match(facts, /You Dress \(Black \/ 1\) — shipped/)
  assert.match(facts, /do not ask them to write from another one/)
  assert.doesNotMatch(facts, /outlook/)
})

test('a product question gets the catalog, not a request for an order (JJ, red Cleo tee)', async () => {
  const { namedProducts, saleState } = await import('../lib/support/draft')
  const shop = [{ title: 'Cleo Tee - Ruby Red' }, { title: 'Cleo Tee' }, { title: 'Story Dress' }, { title: 'Cleo Bag' }, { title: 'Cachet' }]
  assert.deepEqual(namedProducts(shop, 'Hi!\n\nIs the red Cleo tee available in size 1?').map((p) => p.title), ['Cleo Tee - Ruby Red', 'Cleo Tee'])
  assert.deepEqual(namedProducts(shop, 'Where is my order?'), [])
  // Unlisted Ruby Red: nothing to buy.
  assert.equal(saleState(false, { availableForSale: false, inventoryPolicy: 'DENY', inventoryQuantity: 0 }), 'sold out, cannot be ordered')
  // Black / 1 at -121 with overselling on: a pre-order.
  assert.match(saleState(true, { availableForSale: true, inventoryPolicy: 'CONTINUE', inventoryQuantity: -121 }), /pre-order/)
  assert.equal(saleState(true, { availableForSale: true, inventoryPolicy: 'DENY', inventoryQuantity: 17 }), 'in stock')
})
