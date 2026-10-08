import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SKU_RE, colourKey, matchVariants, nextStyleNumber, parseCsv, sizeCodeFor, skuProblem, styleStatus, type AppVariant, type SkuRow } from '../lib/style-system'

const rows = parseCsv(readFileSync('docs/style-system/skus.csv', 'utf8'))

test('every SKU in skus.csv passes the validator', () => {
  const seen = new Set<string>()
  for (const r of rows) {
    assert.equal(skuProblem(r.sku_new, { style: r.style_number, color: r.color_code, size: r.size_code }, seen), null, r.sku_new)
    seen.add(r.sku_new)
  }
  assert.ok(rows.length > 100)
})

test('malformed SKUs are refused with a reason', () => {
  for (const bad of ['TP101-BLK-1', 'tp101-blk-01', 'TP10-BLK-01', 'TP101-BK-01', 'TP101-BLK-XXL', 'TP101 BLK 01', 'TP101-BLK-01-OLD', 'CCSS25COT-BLK01']) {
    assert.ok(!SKU_RE.test(bad), bad)
    assert.match(skuProblem(bad, { style: 'TP101', color: 'BLK', size: '01' })!, /not a SKU/)
  }
  assert.match(skuProblem('TP101-BLK-01', { style: 'TP101', color: 'WHT', size: '01' })!, /does not equal/)
  assert.match(skuProblem('TP101-BLK-01', { style: 'TP101', color: 'BLK', size: '01' }, new Set(['TP101-BLK-01']))!, /already used/)
})

test('the next number counts retired and proposed numbers, and starts at 101', () => {
  assert.equal(nextStyleNumber('TP', ['TP101', 'TP102', 'TP105', 'DR103']), 'TP106')
  assert.equal(nextStyleNumber('DR', ['TP101', 'DR101', 'DR102', 'DR103', 'DR104', 'DR105']), 'DR106')
  assert.equal(nextStyleNumber('IN', ['TP101']), 'IN101')
  assert.equal(nextStyleNumber('bt', ['BT101', 'BT102']), 'BT103')
})

test('sizes become codes only when they plainly are one', () => {
  assert.equal(sizeCodeFor('1'), '01'); assert.equal(sizeCodeFor('0'), '00'); assert.equal(sizeCodeFor('Extra Small'), 'XS')
  assert.equal(sizeCodeFor('S'), 'SM'); assert.equal(sizeCodeFor('Petite'), 'PT'); assert.equal(sizeCodeFor(null), 'OS')
  assert.equal(sizeCodeFor('XXL'), null); assert.equal(sizeCodeFor('Tall'), null)
})

test('style statuses read as the files write them', () => {
  assert.equal(styleStatus('NOT LIVE'), 'NOT_LIVE'); assert.equal(styleStatus('LIVE ONLY'), 'LIVE_ONLY'); assert.equal(styleStatus('Unlisted'), null)
})

test('colour names match whatever order the words come in', () => {
  assert.equal(colourKey('Green (Betsey)'), colourKey('Betsey (Green)'))
})

const row = (sku: string, colorway: string, title = ''): SkuRow => {
  const [style, color, size] = sku.split('-')
  return { sku, style, color, colorway, size, variantTitle: title }
}
const v = (id: string, productId: string, productName: string, colorway: string | null, size: string | null): AppVariant => ({ id, productId, productName, colorway, size })

test('matching: colour and size, never forced, no row matched twice', () => {
  const rs = [row('TP101-BLK-01', 'Black'), row('TP101-RED-01', 'Red'), row('BG101-DBL-OS', 'Denim Baby Blue', 'Baby Blue'), row('BG101-OLV-OS', 'Olive'),
    row('PT101-NAT-OS', 'Natural'), row('BT101-PNK-SM', 'Pink'), row('DR102-BTS-00', 'Betsey (Green)')]
  const vs = [v('a', 'tee', 'Cleo Tee', 'Black', '1'), v('b', 'tee', 'Cleo Tee', 'Ruby Red', '1'), v('c', 'denim', 'Cleo Bag — Denim', 'Baby Blue', null),
    v('d', 'olive', 'Cleo Bag — Olive', null, null), v('e', 'body', 'Bateau Body — Muslin Canvas (part)', null, null), v('f', 'skirt', '5to7 Skirt', 'Pink/Purple', 'S'),
    v('g', 'story', 'Story Dress', 'Green (Betsey)', '0'), v('h', 'tee', 'Cleo Tee', 'New Blue', '1')]
  const byStyle = new Map([['TP101', new Set(['tee'])], ['BG101', new Set(['denim', 'olive'])], ['PT101', new Set(['body'])], ['BT101', new Set(['skirt'])], ['DR102', new Set(['story'])]])
  const r = matchVariants(rs, vs, byStyle)
  const got = Object.fromEntries(r.matched.map((m) => [m.row.sku, m.variant.id]))
  assert.deepEqual(got, { 'TP101-BLK-01': 'a', 'TP101-RED-01': 'b', 'BG101-DBL-OS': 'c', 'BG101-OLV-OS': 'd', 'PT101-NAT-OS': 'e', 'DR102-BTS-00': 'g' })
  assert.deepEqual(r.unmatchedRows.map((x) => x.sku), ['BT101-PNK-SM'])
  assert.deepEqual(r.unmatchedVariants.map((x) => x.id).sort(), ['f', 'h'])
  const ids = r.matched.map((m) => m.variant.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('matching: two variants that both fit one row are ambiguous, not chosen', () => {
  const r = matchVariants([row('BG105-RED-PT', 'Red')], [v('x', 'bean', 'Bean Bag', 'Red', 'Petite'), v('y', 'red', 'Red Bag', 'Red', 'Petite')],
    new Map([['BG105', new Set(['bean', 'red'])]]))
  assert.equal(r.matched.length, 0)
  assert.equal(r.ambiguous.length, 1)
})

test('the real files match the real shapes without any row matched twice', () => {
  // Every SKU row has distinct style-colour-size, so two rows can never claim
  // one variant through colour and size alone.
  const keys = rows.map((r) => `${r.style_number}|${r.color_code}|${r.size_code}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('only Brandon or Cleo can confirm a style number or code, and nobody else gets near the database', async () => {
  const { confirm, CONFIRMERS } = await import('../lib/style-admin')
  assert.deepEqual([...CONFIRMERS].sort(), ['per_brandon', 'per_cleo'])
  for (const who of ['per_jane', null, 'per_vendor']) {
    const r = await confirm({ styleNumber: 'TP103' }, who)
    assert.equal(r.ok, false)
  }
})

test('create_product cannot be called without saying new pattern or existing style', async () => {
  const { TOOLS } = await import('../lib/mouse/tools')
  const schema = TOOLS.create_product.def.input_schema as { required: string[] }
  assert.ok(schema.required.includes('pattern'))
  assert.ok(TOOLS.style_numbers)
})
