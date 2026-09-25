import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseDeliverTo } from '../lib/po-deliver-to'

const CLEO = 'Cleo Camp, 6351 Primrose Ave, Los Angeles, CA 90068'
const LORENA = 'Gloria Llamas (Lorena), 10408 California Ave, South Gate, CA 90280'

test('the 2386 case: a replacement takes the address of the order it replaces', () => {
  const r = chooseDeliverTo({
    replaces: { poNumber: '2384', deliverTo: CLEO },
    recent: [{ poNumber: '2385', deliverTo: LORENA }, { poNumber: '2384', deliverTo: CLEO }],
  })
  assert.equal(r.value, CLEO)
  assert.match(r.from!, /2384/)
})

test('recent orders to different places: nothing is carried over, and the places are named', () => {
  const r = chooseDeliverTo({ recent: [{ poNumber: '2385', deliverTo: LORENA }, { poNumber: '2384', deliverTo: CLEO }] })
  assert.equal(r.value, null)
  assert.deepEqual(r.conflict.sort(), [CLEO, LORENA].sort())
})

test('a vendor that always ships to one place still carries it over', () => {
  const r = chooseDeliverTo({ recent: [{ poNumber: '2380', deliverTo: CLEO }, { poNumber: '2371', deliverTo: CLEO }, { poNumber: '2365', deliverTo: null }] })
  assert.equal(r.value, CLEO)
})

test('an address given in the call always wins', () => {
  assert.equal(chooseDeliverTo({ given: LORENA, replaces: { poNumber: '2384', deliverTo: CLEO }, recent: [] }).value, LORENA)
})

test('no history, no address', () => {
  assert.deepEqual(chooseDeliverTo({ recent: [] }), { value: null, from: null, conflict: [] })
})
