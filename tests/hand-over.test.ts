import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handOverBlocked, type HandOverOrder } from '@/lib/live-sale'

const order = (o: Partial<HandOverOrder> = {}): HandOverOrder => ({
  id: 'gid://shopify/Order/1', name: '#3097', email: 'a@b.com', tags: ['invoice', 'studio-mouse'],
  cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', fulfillments: [], ...o,
})

test('an unfulfilled invoice order can be marked handed over', () => {
  assert.equal(handOverBlocked(order()), null)
})

test('an order already shipped with a label is refused and says a second one went out', () => {
  const why = handOverBlocked(order({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ status: 'SUCCESS', tracking: ['9200190267'] }] }))
  assert.match(why ?? '', /already shipped/)
  assert.match(why ?? '', /9200190267/)
  assert.match(why ?? '', /stock/)
})

test('an order already marked fulfilled without a label needs nothing', () => {
  assert.match(handOverBlocked(order({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ status: 'SUCCESS', tracking: [] }] })) ?? '', /Nothing to do/)
})

test('a cancelled fulfillment does not count as shipped', () => {
  assert.equal(handOverBlocked(order({ fulfillments: [{ status: 'CANCELLED', tracking: ['1Z'] }] })), null)
})

test('a web order and a cancelled order are refused', () => {
  assert.match(handOverBlocked(order({ tags: [] })) ?? '', /web order/)
  assert.match(handOverBlocked(order({ cancelledAt: '2026-11-20T00:00:00Z' })) ?? '', /cancelled/)
})
