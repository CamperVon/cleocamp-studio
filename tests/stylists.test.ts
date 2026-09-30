import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickStylist } from '../lib/stylists'

const all = [
  { id: 'nat', name: 'Natasha Colvin' },
  { id: 'maya', name: 'Maya (ellner studio)' },
  { id: 'nat2', name: 'Natalie Price' },
]

test('the Natasha pull filed under Maya is refused', () => {
  const r = pickStylist(all, 'maya', 'Natasha Colvin')
  assert.ok('reason' in r)
  assert.match((r as { reason: string }).reason, /is Maya \(ellner studio\), not Natasha Colvin/)
})

test('by name, whole or in part', () => {
  assert.deepEqual(pickStylist(all, null, 'Natasha Colvin'), { stylist: all[0] })
  assert.deepEqual(pickStylist(all, null, 'colvin'), { stylist: all[0] })
  assert.deepEqual(pickStylist(all, null, 'Maya'), { stylist: all[1] })
  assert.deepEqual(pickStylist(all, 'nat', 'Natasha'), { stylist: all[0] })
})

test('two matches is a question, none is a question', () => {
  assert.match((pickStylist(all, null, 'Nat') as { reason: string }).reason, /More than one/)
  assert.match((pickStylist(all, null, 'Sofie') as { reason: string }).reason, /No stylist called/)
  assert.match((pickStylist(all, 'nope', null) as { reason: string }).reason, /No stylist nope/)
})

test('removing a pull gives back only what it took and has not had back', async () => {
  const { stillTaken, pullOut } = await import('../lib/stylists')
  const m = stillTaken([
    { productVariantId: 'splish1', deltaQty: -1 },
    { productVariantId: 'shell2', deltaQty: -2 }, { productVariantId: 'shell2', deltaQty: 1 },
    { productVariantId: 'belt', deltaQty: -1 }, { productVariantId: 'belt', deltaQty: 1 },
  ])
  assert.deepEqual([...m], [['splish1', 1], ['shell2', 1]])
  // The black tee Shopify refused has no event, so it is not in the map at all.
  assert.equal(m.has('black1'), false)
  assert.equal(pullOut({ closedAs: null, lines: [{ qty: 2, returnedQty: 1 }] }), 1)
  assert.equal(pullOut({ closedAs: 'KEPT', lines: [{ qty: 2, returnedQty: 0 }] }), 0)
})
