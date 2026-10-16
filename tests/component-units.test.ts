import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unitChangeProblem } from '../lib/mouse/tools'
import { purchaseUnitPrice } from '../lib/po-units'

// 12 Oct 2026: the 5to7 shell is counted in yards and bought by the metre.

test('the price shows in the buying unit, the counting unit beside it', () => {
  assert.deepEqual(purchaseUnitPrice({ unitCostCents: 1119, unitOfMeasure: 'yard', purchaseUnit: 'metre', unitsPerPurchaseUnit: '1.0936' }), { cents: 1224, unit: 'metre' })
  assert.equal(purchaseUnitPrice({ unitCostCents: 1119, unitOfMeasure: 'yard', purchaseUnit: 'yards', unitsPerPurchaseUnit: 1 }), null)
  assert.equal(purchaseUnitPrice({ unitCostCents: 1119, unitOfMeasure: 'yard', purchaseUnit: 'metre', unitsPerPurchaseUnit: null }), null)
  assert.equal(purchaseUnitPrice({ unitCostCents: null, unitOfMeasure: 'yard', purchaseUnit: 'metre', unitsPerPurchaseUnit: 1.0936 }), null)
})

test('a counting unit changes only while nothing is recorded in the old one', () => {
  assert.equal(unitChangeProblem({ from: 'yard', to: 'metre', events: 0, poLines: 0, onHand: 0 }), null)
  assert.equal(unitChangeProblem({ from: 'yard', to: 'yard', events: 3, poLines: 1, onHand: 9 }), null)
  assert.match(unitChangeProblem({ from: 'yard', to: 'metre', events: 1, poLines: 0, onHand: 0 })!, /silently read as metres/)
  assert.match(unitChangeProblem({ from: 'yard', to: 'metre', events: 0, poLines: 2, onHand: 0 })!, /purchaseUnit/)
  assert.ok(unitChangeProblem({ from: 'yard', to: ' ', events: 0, poLines: 0, onHand: 0 }))
})

// 16 Oct 2026: Black leather (Cleo Bag) was counted in skins, and Lorena's
// 10.36 sq ft a bag could not go on the recipe. A switch restates everything.
test('a unit switch with stock on file restates it at the given rate', async () => {
  const { planUnitConversion } = await import('../lib/unit-convert')
  const base = {
    from: 'skin', to: 'sq ft', perOldUnit: 25, basis: 'United Leather UL49027, 2 hides = 50 sq ft',
    places: [{ id: 'p1', qty: 4, name: 'Lorena and Santos' }],
    recipes: [{ id: 'b1', qty: 0, label: 'Cleo Bag — Black' }, { id: 'b2', qty: 0.5, label: 'Other' }],
    unitCostCents: 16250, reorderThreshold: 2, purchaseUnit: 'skin', openPoLines: [],
  }
  const plan = planUnitConversion(base)
  assert.ok(!('error' in plan))
  if ('error' in plan) return
  assert.deepEqual(plan.places, [{ id: 'p1', name: 'Lorena and Santos', was: 4, now: 100 }])
  assert.deepEqual(plan.recipes.map((r) => r.now), [0, 12.5])
  assert.equal(plan.unitCostCents, 650)
  assert.equal(plan.reorderThreshold, 50)
  assert.equal(plan.purchaseUnit, 'sq ft')
  assert.equal((planUnitConversion({ ...base, purchaseUnit: 'roll' }) as { purchaseUnit?: string }).purchaseUnit, undefined)
  assert.match((planUnitConversion({ ...base, perOldUnit: 0 }) as { error: string }).error, /above zero/)
  assert.match((planUnitConversion({ ...base, basis: ' ' }) as { error: string }).error, /comes from/)
  assert.match((planUnitConversion({ ...base, openPoLines: ['PO 2405'] }) as { error: string }).error, /PO 2405/)
})

test('the refusal says how to switch anyway', () => {
  assert.match(unitChangeProblem({ from: 'skin', to: 'sq ft', events: 2, poLines: 0, onHand: 4 })!, /perOldUnit/)
})

test('a component left off products on purpose is not raised', async () => {
  const { onNoProduct } = await import('../lib/bom')
  assert.equal(onNoProduct({ category: 'HARDWARE', _count: { usedIn: 0 } }), true)
  assert.equal(onNoProduct({ category: 'HARDWARE', offProducts: true, _count: { usedIn: 0 } }), false)
  assert.equal(onNoProduct({ category: 'PACKAGING', _count: { usedIn: 0 } }), false)
})
