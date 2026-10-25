import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planShipment, stillOpen, type OpenLine } from '../lib/shipments'

// Marking a box as shipped (25 Oct 2026), all or nothing.

const open: OpenLine[] = [
  { fulfillmentOrderId: 'fo1', lineId: 'a', remaining: 2, title: 'Cleo Tee - Shell', variantTitle: 'Shell / 1', shopifyVariantId: '111' },
  { fulfillmentOrderId: 'fo1', lineId: 'b', remaining: 2, title: 'Cleo Tee - Splish', variantTitle: 'Splish / 2', shopifyVariantId: '222' },
  { fulfillmentOrderId: 'fo1', lineId: 'c', remaining: 10, title: 'Bean Bag / Cannellini / Petite', variantTitle: null, shopifyVariantId: null },
  { fulfillmentOrderId: 'fo1', lineId: 'd', remaining: 10, title: 'Bean Bag / Espresso / Petite', variantTitle: null, shopifyVariantId: null },
]

test('only what went in the box is picked; the rest stays open', () => {
  const r = planShipment(open, [{ shopifyVariantId: 'gid://shopify/ProductVariant/111', quantity: 2, label: 'Shell 1' }, { description: 'Cannellini Bean Bag', quantity: 4, label: 'Cannellini' }])
  assert.deepEqual(r.problems, [])
  assert.deepEqual(r.picks.map((p) => [p.lineId, p.quantity]), [['a', 2], ['c', 4]])
  assert.deepEqual(stillOpen(open, r.picks), ['2 × Cleo Tee - Splish / Splish / 2', '6 × Bean Bag / Cannellini / Petite', '10 × Bean Bag / Espresso / Petite'])
})

test('anything that does not match, or is more than is left, is a problem', () => {
  assert.equal(planShipment(open, [{ shopifyVariantId: '999', quantity: 1, label: 'Black 3' }]).problems.length, 1)
  assert.equal(planShipment(open, [{ shopifyVariantId: '222', quantity: 3, label: 'Splish 2' }]).problems.length, 1)
  assert.equal(planShipment(open, [{ description: 'Bean Bag', quantity: 1, label: 'a bean bag' }]).problems.length, 1, 'two typed-in lines match: ask which')
  assert.equal(planShipment(open, [{ shopifyVariantId: '111', quantity: 0, label: 'Shell 1' }]).problems.length, 1)
})
