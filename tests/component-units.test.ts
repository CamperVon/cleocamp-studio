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
