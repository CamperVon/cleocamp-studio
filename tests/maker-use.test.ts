import assert from 'node:assert/strict'
import test from 'node:test'
import { trimsUsed, type RecipeLine } from '../lib/maker-use'

const cleoTee: RecipeLine[] = [
  { componentId: 'fabric', qtyPerUnit: 1.2, size: null, colorway: null, category: 'MATERIAL' },
  { componentId: 'hangtag', qtyPerUnit: 1, size: null, colorway: null, category: 'TRIM' },
  { componentId: 'glassine', qtyPerUnit: 1, size: null, colorway: null, category: 'PACKAGING' },
  { componentId: 'num1', qtyPerUnit: 1, size: '1', colorway: null, category: 'PACKAGING' },
  { componentId: 'num2', qtyPerUnit: 1, size: '2', colorway: null, category: 'PACKAGING' },
  { componentId: 'studioOnly', qtyPerUnit: 1, size: null, colorway: null, category: 'TRIM' },
]
const held = new Set(['fabric', 'hangtag', 'glassine', 'num1', 'num2'])

test('finished tees take their trims off the maker, size-specific ones by size', () => {
  const used = trimsUsed(cleoTee, { size: '1', colorway: { customerName: 'Black' } }, 154, held)
  assert.deepEqual(used.sort((a, b) => a.componentId.localeCompare(b.componentId)), [
    { componentId: 'glassine', qty: 154 }, { componentId: 'hangtag', qty: 154 }, { componentId: 'num1', qty: 154 },
  ])
})

test('fabric is never taken again on delivery, and what the maker does not hold is left alone', () => {
  const ids = trimsUsed(cleoTee, { size: '2', colorway: null }, 10, held).map((u) => u.componentId)
  assert.ok(!ids.includes('fabric'))
  assert.ok(!ids.includes('studioOnly'))
  assert.ok(ids.includes('num2') && !ids.includes('num1'))
})
