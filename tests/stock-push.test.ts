import assert from 'node:assert/strict'
import test from 'node:test'
import { planVariantPush, isStaleCountRefusal } from '../lib/stock-push'

test('new stock is added on top of Shopify\'s live count, not ours', () => {
  // We last saw 5; a web order since then left Shopify at 4. 20 arrive.
  assert.deepEqual(planVariantPush({ live: 4, ledger: 5, deltaQty: 20 }), { drift: -1, push: 20, next: 24 })
})

test('a count sets Shopify to the counted number, whatever it had', () => {
  assert.deepEqual(planVariantPush({ live: 4, ledger: 5, countedQty: 12 }), { drift: -1, push: 8, next: 12 })
  assert.deepEqual(planVariantPush({ live: 12, ledger: 12, countedQty: 12 }), { drift: 0, push: 0, next: 12 })
})

test('drift plus the change always lands the ledger on the new count', () => {
  for (const [live, ledger, delta] of [[4, 5, 20], [0, 3, -0], [7, 2, -2], [10, 10, 1]]) {
    const p = planVariantPush({ live, ledger, deltaQty: delta })
    assert.equal(ledger + p.drift + p.push, p.next)
  }
})

test('only Shopify\'s stale-count refusal is retried', () => {
  assert.equal(isStaleCountRefusal('The changeFromQuantity argument no longer matches the persisted quantity.'), true)
  assert.equal(isStaleCountRefusal('Access denied for inventoryAdjustQuantities'), false)
})
