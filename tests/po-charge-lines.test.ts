import assert from 'node:assert/strict'
import test from 'node:test'
import { isChargeLine } from '../lib/po-receipts'

test('shipping, tax and fees on an order are charges, never goods owed', () => {
  for (const d of ['Shipping & Handling', 'Sales tax (10.25%)', 'Shipping, Ground', 'Freight', 'Setup fee', 'Duties']) assert.ok(isChargeLine({ description: d }), d)
  // A free-text line for goods is still goods.
  assert.equal(isChargeLine({ description: '1650SL Stretch silk charmeuse, Color: 3140 (sample yardage)' }), false)
  // Anything tied to a component or a product is goods, whatever it says.
  assert.equal(isChargeLine({ componentId: 'c1', description: 'Shipping tape' }), false)
})
