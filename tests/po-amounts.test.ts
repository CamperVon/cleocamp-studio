import assert from 'node:assert/strict'
import test from 'node:test'
import { poAmounts } from '../lib/po'

test('unknown prices remain incomplete while confirmed zero prices remain complete', () => {
  assert.deepEqual(poAmounts([
    { qtyOrdered: 300, unitCostCents: 400 },
    { qtyOrdered: 200, unitCostCents: null },
  ]), { knownCents: 120000, incomplete: true })
  assert.deepEqual(poAmounts([{ qtyOrdered: 200, unitCostCents: 0 }]), { knownCents: 0, incomplete: false })
})

test('fractional quantities total the rounded printed line amounts', () => {
  assert.deepEqual(poAmounts([
    { qtyOrdered: 1.5, unitCostCents: 101 },
    { qtyOrdered: 1.5, unitCostCents: 101 },
  ]), { knownCents: 304, incomplete: false })
})
