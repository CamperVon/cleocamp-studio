import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oneOffKey, sheetDescription, chargedDifferently, dollars, ditto, heldBackFor, lineSheetFileName, missingRows, onThePdf, resolveRow, variantsFor } from '../lib/line-sheet'

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
  // Suggested retail is Shopify's on a linked row, whatever range the row carries.
  assert.equal(resolveRow({ colorway: 'Champagne', wholesaleCents: null, msrp: '$368 – $420+' }, bean).retail, '$368')
})

test('a row with no product carries its own price', () => {
  assert.deepEqual(resolveRow({ colorway: null, wholesaleCents: 9400, msrp: '$148 – $158' }, null), { wholesaleCents: 9400, retail: '$148 – $158', photo: null, onHand: null, description: '' })
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

const sv = (colour: string | null, size: string | null, shop = true, active = true) =>
  ({ size, shopifyVariantId: shop ? `gid://${colour}/${size}` : null, colorway: colour ? { customerName: colour, active } : null })

test('a new product on Shopify gets a row; a part, or one not on Shopify, does not', () => {
  const add = missingRows([
    { id: 'ls', name: 'Little Sister', variants: [sv('Black', '1'), sv('Black', '2')] },
    { id: 'body', name: 'Bateau Body — Muslin Canvas (part)', variants: [sv(null, null)] },
    { id: 'dev', name: 'Hair Tie', variants: [sv(null, null, false)] },
  ], [])
  assert.deepEqual(add, [{ productId: 'ls', item: 'Little Sister', colorway: null, colorLabel: 'Black', sizing: '1, 2' }])
})

test('a new colour of a product sold colour by colour gets its own row', () => {
  const tee = { id: 'tee', name: 'Cleo Tee', variants: [sv('White', '1'), sv('Red (Wiltshire)', '1'), sv('Ruby Red', '1', true, false), sv('Bean Red', '1', false)] }
  const add = missingRows([tee], [{ productId: 'tee', colorway: 'White' }, { productId: 'tee', colorway: 'Red' }])
  assert.deepEqual(add, [])
  const more = missingRows([{ ...tee, variants: [...tee.variants, sv('New Blue', '1'), sv('New Blue', '2')] }], [{ productId: 'tee', colorway: 'White' }, { productId: 'tee', colorway: 'Red' }])
  assert.deepEqual(more, [{ productId: 'tee', item: 'Cleo Tee', colorway: 'New Blue', colorLabel: 'New Blue', sizing: '1, 2' }])
})

test('a row for the whole product, or a removed one, counts as there', () => {
  const bag = { id: 'bag', name: 'Bateau Bag', variants: [sv('Gold', null), sv('Silver', null)] }
  assert.deepEqual(missingRows([bag], [{ productId: 'bag', colorway: null }]), [])
  assert.deepEqual(missingRows([bag], []), [{ productId: 'bag', item: 'Bateau Bag', colorway: null, colorLabel: 'Gold, Silver', sizing: '' }])
})

test('a row is held off the PDF until it has a wholesale price and a description', () => {
  assert.equal(onThePdf({ wholesaleCents: 5400, hidden: false, description: 'Rib cotton.' }), true)
  assert.equal(onThePdf({ wholesaleCents: null, hidden: false, description: 'Rib cotton.' }), false)
  assert.equal(onThePdf({ wholesaleCents: 5400, hidden: false, description: ' ' }), false)
  assert.equal(onThePdf({ wholesaleCents: 5400, hidden: true, description: 'Rib cotton.' }), false)
  assert.deepEqual(heldBackFor({ wholesaleCents: null, description: '' }), ['a wholesale price', 'a description'])
})

test('the newest invoice charging off the list is flagged, on the list is not', () => {
  const products = [
    { name: 'Boy Belt', wholesalePriceCents: 13000, variants: [] },
    { name: 'Cleo Tee', wholesalePriceCents: 5400, variants: [] },
  ]
  const shipments = [
    { id: 's1', sentAt: new Date('2026-08-25'), invoiceName: null, account: 'Grandpa LA', lines: [{ item: 'Cleo Tee / Black / 1', qty: 2, wholesaleCents: 10200 }] },
    { id: 's2', sentAt: new Date('2026-09-28'), invoiceName: '#2644', account: 'Grandpa LA', lines: [
      { item: 'Cleo Tee / Black / 1', qty: 7, wholesaleCents: 37800 },
      { item: 'Boy Belt / Small', qty: 2, wholesaleCents: 18000 },
      { item: 'Boy Belt / Medium', qty: 1, wholesaleCents: 8000 },
      { item: 'Boy Belt / size 90', qty: 1, wholesaleCents: 0 },
    ] },
  ]
  const off = chargedDifferently(products, shipments)
  assert.equal(off.length, 1)
  assert.equal(off[0].product, 'Boy Belt')
  assert.deepEqual(off[0].charged, [8000, 9000])
  assert.equal(off[0].invoice, '#2644')
  assert.equal(off[0].key, oneOffKey('s2', 'Boy Belt'))
  // Marked a one-off: not shown again.
  assert.deepEqual(chargedDifferently(products, shipments, new Set([off[0].key])), [])
})

test('a Shopify description is cut to fit the sheet', () => {
  assert.equal(sheetDescription('Unisex. Handcrafted in Italy. Size Guide'), 'Unisex. Handcrafted in Italy.')
  assert.equal(sheetDescription('First paragraph.\nSecond one.'), 'First paragraph.')
  const long = `${'A sentence of about forty characters here. '.repeat(10)}`
  const cut = sheetDescription(long)
  assert.ok(cut.length <= 320 && cut.endsWith('.'))
  assert.equal(sheetDescription(null), '')
})

test('a row with its own words keeps them; one without prints Shopify\'s', () => {
  const p = { id: 'x', wholesalePriceCents: 4000, retailPriceCents: 6800, shopifyDescription: 'Fits both Bateau bags.', variants: [v(null, null, 6800)] }
  assert.equal(resolveRow({ colorway: null, wholesaleCents: null, msrp: null, description: '' }, p).description, 'Fits both Bateau bags.')
  assert.equal(resolveRow({ colorway: null, wholesaleCents: null, msrp: null, description: 'Our words.' }, p).description, 'Our words.')
})
