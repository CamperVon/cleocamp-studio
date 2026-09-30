import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dollars, ditto, lineSheetFileName, resolveRow, variantsFor } from '../lib/line-sheet'

const v = (colour: string | null, ws: number | null, retail: number | null, onHand = 1, img: string | null = null) =>
  ({ wholesalePriceCents: ws, retailPriceCents: retail, imageUrl: img, onHandQty: onHand, colorway: colour ? { customerName: colour } : null })

test('dollars prints whole dollars without cents', () => {
  assert.equal(dollars(5400), '$54')
  assert.equal(dollars(21450), '$214.50')
  assert.equal(dollars(250000), '$2,500')
})

test('a colour matches exactly, or by its start ("Red" finds "Red (Wiltshire)")', () => {
  const p = { variants: [v('Red (Wiltshire)', null, 34800), v('Green (Betsey)', null, 34800)] }
  assert.equal(variantsFor(p, 'Red').length, 1)
  assert.equal(variantsFor(p, null).length, 2)
})

test('prices are read from the product, never from the row, when the row has one', () => {
  const bean = { id: 'b', wholesalePriceCents: null, retailPriceCents: 39800, variants: [v('Champagne', 21400, 36800, 4, 'https://x/c.jpg'), v('Silver', 23100, 39800, 0)] }
  const champagne = resolveRow({ colorway: 'Champagne', wholesaleCents: 99, msrp: null }, bean)
  assert.equal(champagne.wholesaleCents, 21400)
  assert.equal(champagne.retail, '$368')
  assert.equal(champagne.photo, 'https://x/c.jpg')
  assert.equal(champagne.onHand, 4)
  assert.equal(resolveRow({ colorway: null, wholesaleCents: null, msrp: null }, bean).retail, '$368 – $398')
  assert.equal(resolveRow({ colorway: 'Champagne', wholesaleCents: null, msrp: '$368 – $420+' }, bean).retail, '$368 – $420+')
})

test('a row with no product carries its own price', () => {
  assert.deepEqual(resolveRow({ colorway: null, wholesaleCents: 9400, msrp: '$148 – $158' }, null), { wholesaleCents: 9400, retail: '$148 – $158', photo: null, onHand: null })
})

test('ditto repeats only an identical cell below a non-empty one', () => {
  assert.equal(ditto('Same text.', 'Same text.'), '"')
  assert.equal(ditto('One.', 'Two.'), 'Two.')
  assert.equal(ditto(undefined, 'First.'), 'First.')
  assert.equal(ditto('', ''), '')
})

test('file name is dated in Los Angeles', () => {
  assert.equal(lineSheetFileName(new Date('2026-10-01T05:00:00Z')), 'Cleo-Camp-Line-Sheet-2026-09-30.pdf')
})
