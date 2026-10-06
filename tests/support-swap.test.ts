import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDraft, pickSwapLine, pickTargetVariant, swapClaims, swapNotDone, variantKey } from '../lib/support/reply'
import type { OrderSnapshot } from '../lib/support/orders'

// #2297, 6 Oct 2026: the reply promised a size change that nothing made.
const REPLY = `Yes, we can switch that for you. We'll change your Cleo Tee in order #2297 from White / 1 to White / 2, and send it to:\n\nSusan Maldoff\n3170 S Ocean Blvd, Unit 705 S\nPalm Beach, FL 33480`
const order = (variant: string, unfulfilled = 1): OrderSnapshot => ({
  id: 'o', name: '#2297', createdAt: '', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: null, email: 'a@b.c', tracking: [],
  items: [{ id: 'gid://shopify/LineItem/1', title: 'Cleo Tee', variant, quantity: 1, current: 1, unfulfilled, variantId: 'v1' }],
})

test('a reply promising a size change is held until Shopify shows it', () => {
  assert.deepEqual(swapClaims(REPLY), ['White / 2'])
  assert.equal(swapNotDone(REPLY, order('White / 1')).length, 1)
  assert.deepEqual(swapNotDone(REPLY, order('White / 2')), [])
})

test('an address change or a shipped order is not read as a swap', () => {
  assert.deepEqual(swapClaims("We've changed the address from LA to New York."), [])
  assert.deepEqual(swapNotDone("Once it's back we'll exchange it to a size 2.", order('White / 1', 0)), [])
})

test('"size 2" matches the last part of the variant', () => {
  assert.deepEqual(swapNotDone("We'll size you up to a size 2.", order('White / 2')), [])
  assert.equal(variantKey('White / Size 2'), variantKey('white/2'))
})

test('the drafter names the swap; code finds exactly one line and variant', () => {
  const d = parseDraft('{"reply":"Hi","needs":null,"newAddress":null,"newVariant":{"item":"Cleo Tee","from":"White / 1","to":"White / 2"}}')
  assert.deepEqual(d?.newVariant, { item: 'Cleo Tee', from: 'White / 1', to: 'White / 2' })
  const l = pickSwapLine(order('White / 1'), d!.newVariant!)
  assert.ok(l.ok && l.line.id === 'gid://shopify/LineItem/1' && l.line.quantity === 1)
  assert.equal(pickSwapLine(order('White / 1', 0), d!.newVariant!).ok, false)
  const vs = [{ id: 'v1', title: 'White / 1' }, { id: 'v2', title: 'White / 2' }]
  assert.deepEqual(pickTargetVariant(vs, 'White / 2', 'v1'), { ok: true, id: 'v2', title: 'White / 2' })
  assert.equal(pickTargetVariant(vs, 'White / 3', 'v1').ok, false)
  assert.equal(pickTargetVariant(vs, 'White / 1', 'v1').ok, false)
})
