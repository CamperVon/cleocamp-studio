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
