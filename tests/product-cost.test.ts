import { test } from 'node:test'
import assert from 'node:assert/strict'
import { variantCost, costSummary, componentPrice } from '../lib/product-cost'

const comp = (name: string, cents: number | null, unit = 'pc', category = 'TRIM') => ({ id: name, name, category, unitOfMeasure: unit, unitCostCents: cents })
const lorena = { cents: 8500, currency: 'USD', vendor: 'Lorena and Santos', poNumber: '2405' }

test('recipe plus the maker: the Silver Cleo Bag', () => {
  const c = variantCost('Silver', [
    { qtyPerUnit: 10.36, component: comp('Silver leather', 750, 'sq ft', 'MATERIAL') },
    { qtyPerUnit: 1, component: comp('Snap', 290) },
    { qtyPerUnit: 2, component: comp('Newsprint', 6, 'sheet', 'PACKAGING') },
  ], { size: null }, lorena)
  assert.equal(c.recipeCents, 7770 + 290 + 12)
  assert.equal(c.totalCents, 8072 + 8500)
  assert.equal(c.complete, true)
})

test('a missing price or quantity is named and the total is a floor', () => {
  const c = variantCost('1', [
    { qtyPerUnit: 1, component: comp('Label', 25) },
    { qtyPerUnit: 1, component: comp('Sticker', null) },
    { qtyPerUnit: 0, component: comp('Fabric', 315, 'yard', 'MATERIAL') },
  ], { size: '1' }, lorena)
  assert.equal(c.totalCents, 25 + 8500)
  assert.equal(c.complete, false)
  assert.deepEqual(c.unpriced, ['Sticker (no price)', 'Fabric (quantity unknown)'])
})

test('lines for another size or colour are left out', () => {
  const c = variantCost('2', [
    { qtyPerUnit: 1, size: '1', component: comp('Size 1 sticker', 3) },
    { qtyPerUnit: 1, size: '2', component: comp('Size 2 sticker', 4) },
    { qtyPerUnit: 1, colorway: 'Black', component: comp('Black lining', 100) },
  ], { size: '2', colorway: { customerName: 'White' } }, lorena)
  assert.deepEqual(c.lines.map((l) => l.name), ['Size 2 sticker'])
})

test('no maker on file: incomplete; a euro maker is not added to dollars', () => {
  assert.equal(variantCost('x', [{ qtyPerUnit: 1, component: comp('Label', 25) }], { size: null }, null).complete, false)
  const eur = variantCost('Belt', [{ qtyPerUnit: 1, component: comp('Label', 25) }], { size: null }, { cents: 3800, currency: 'EUR', vendor: 'Belts', poNumber: '1' })
  assert.equal(eur.totalCents, 25)
  assert.equal(eur.complete, false)
  assert.equal(costSummary([eur])?.foreignMaker?.cents, 3800)
})

test('a range when variants differ', () => {
  const a = variantCost('1', [{ qtyPerUnit: 1, component: comp('A', 100) }], { size: null }, lorena)
  const b = variantCost('2', [{ qtyPerUnit: 2, component: comp('A', 100) }], { size: null }, lorena)
  assert.deepEqual(costSummary([a, b]), { lowCents: 8600, highCents: 8700, complete: true, foreignMaker: null })
})

test('a sub-assembly with no price of its own is priced from its parts', () => {
  assert.equal(componentPrice({ ...comp('Handle', null), parts: [{ qtyPerUnit: 2, unitCostCents: 150 }] }), 300)
  assert.equal(componentPrice({ ...comp('Handle', null), parts: [{ qtyPerUnit: 2, unitCostCents: null }] }), null)
})
