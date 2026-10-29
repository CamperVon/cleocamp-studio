import assert from 'node:assert/strict'
import test from 'node:test'
import { undoReturnPlan } from '../lib/stylist-stock'

test('a mistaken return comes back off sales stock from the newest return first', () => {
  assert.deepEqual(undoReturnPlan([{ id: 'a', left: 1 }, { id: 'b', left: 1 }], 0, 1), { sales: [{ id: 'b', qty: 1 }], stylist: 0, alreadyFixed: 0 })
})

test('what is not on sales stock comes off the stylist inventory', () => {
  assert.deepEqual(undoReturnPlan([{ id: 'a', left: 1 }], 2, 3), { sales: [{ id: 'a', qty: 1 }], stylist: 2, alreadyFixed: 0 })
})

test('stock already corrected by hand is never taken off twice', () => {
  // Natasha Colvin's Black / 1: the return event was already corrected, so only the line moves.
  assert.deepEqual(undoReturnPlan([{ id: '263630f5', left: 0 }], 0, 1), { sales: [], stylist: 0, alreadyFixed: 1 })
})
