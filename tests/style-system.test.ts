import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OLD_SKU_RE, SKU_RE, STYLE_RE, colourKey, matchVariants, nextVersion, parseCsv, parseStyle, planSkus, sizeCodeFor, skuProblem, styleProblem, styleStatus, suggestFamilyLetters, type AppVariant, type SkuRow, type SkuVariant } from '../lib/style-system'

const rows = parseCsv(readFileSync('docs/style-system/skus.csv', 'utf8'))

const crosswalk = parseCsv(readFileSync('docs/style-system/crosswalk-2026-10-16.csv', 'utf8'))

test('every new SKU in the crosswalk passes the validator, once, and is its old one with the style swapped', () => {
  const seen = new Set<string>()
  const withSku = crosswalk.filter((r) => r.new_sku)
  for (const r of withSku) {
    const [style, color, size] = r.new_sku.split('-')
    assert.equal(skuProblem(r.new_sku, { style, color, size }, seen), null, r.new_sku)
    seen.add(r.new_sku)
    assert.ok(OLD_SKU_RE.test(r.previous_sku) && !SKU_RE.test(r.previous_sku), `${r.previous_sku} is the old format`)
    assert.equal(r.new_sku, `${r.new_style}-${r.previous_sku.split('-').slice(1).join('-')}`)
  }
  assert.ok(withSku.length > 100)
})

test('the new format: every new style and SKU passes; the old formats are refused for anything new', () => {
  for (const ok of ['TCO101', 'HCD101', 'XBT101', 'ABH101', 'TCO501', 'TCO702', 'SFR101']) assert.ok(STYLE_RE.test(ok), ok)
  for (const ok of ['TCO101-BLK-01', 'HCD101-DBL-OS', 'HBN101-RED-PT', 'BFS101-PNK-XL']) assert.ok(SKU_RE.test(ok), ok)
  for (const bad of ['TCO101-BLK-1', 'tco101-blk-01', 'TC101-BLK-01', 'TCO301-BLK-01', 'TCO101-BK-01', 'TCO101-BLK-XXL', 'TCO101 BLK 01', 'TCO101-BLK-01-OLD', 'CCSS25COT-BLK01', 'TP101-BLK-01']) {
    assert.ok(!SKU_RE.test(bad), bad)
    assert.match(skuProblem(bad, { style: 'TCO101', color: 'BLK', size: '01' })!, /not a SKU/)
  }
  assert.match(skuProblem('TCO101-BLK-01', { style: 'TCO101', color: 'WHT', size: '01' })!, /does not equal/)
  assert.match(skuProblem('TCO101-BLK-01', { style: 'TCO101', color: 'BLK', size: '01' }, new Set(['TCO101-BLK-01']))!, /already used/)
  assert.match(styleProblem('TP106', new Set())!, /old format/)
  assert.match(styleProblem('TCO101', new Set(['TCO101']))!, /never reused/)
  assert.match(styleProblem('QZZ101', new Set())!, /not a category letter/)
  assert.match(styleProblem('TCO100', new Set())!, /starts at 01/)
  assert.match(styleProblem('TCO-101', new Set())!, /not a style number/)
  assert.equal(styleProblem('TCW101', new Set(['TCO101', 'TP101'])), null)
})

test('a new version is the highest in its family and line plus one; letters are suggested from the name', () => {
  assert.equal(nextVersion('TCO', '1', ['TCO101', 'TCO102', 'TCO501', 'TCC101']), 'TCO103')
  assert.equal(nextVersion('TCO', '5', ['TCO101', 'TCO501']), 'TCO502')
  assert.equal(nextVersion('HCD', '1', []), 'HCD101')
  assert.deepEqual(parseStyle('TCO101'), { category: 'T', family: 'TCO', line: '1', version: 1 })
  assert.equal(parseStyle('TP101'), null)
  assert.equal(suggestFamilyLetters('Little Sister'), 'LS')
  assert.equal(suggestFamilyLetters('Cachet'), 'CA')
  assert.equal(suggestFamilyLetters('The Story Dress'), 'SD')
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

test('the style report is one line when nothing is outstanding, and short when something is', async () => {
  const { styleReportLines } = await import('../lib/style-report')
  const clean = { products: [{ name: 'Cleo Tee', status: 'ACTIVE', style: { number: 'TCO101', status: 'ACTIVE' } }],
    variants: [{ label: 'Cleo Tee / Black / 1', styleNumber: 'TCO101', styleStatus: 'ACTIVE', newSku: 'TCO101-BLK-01', colorCode: 'BLK', sizeCode: '01', shopifySku: 'TCO101-BLK-01', linkedToShopify: true }],
    poLines: [{ poNumber: '2400', label: 'Cleo Tee / Black / 1', styleNumber: 'TCO101' }], proposed: { styles: [], codes: [] } }
  assert.deepEqual(styleReportLines(clean), ['Style system: nothing outstanding.'])
  const messy = { ...clean,
    products: [...clean.products, { name: 'Dolce', status: 'DEVELOPMENT', style: null }, { name: 'Old Thing', status: 'SUNSETTED', style: null }],
    variants: [...clean.variants, { label: 'Cleo Tee / White / 1', styleNumber: 'TCO101', styleStatus: 'ACTIVE', newSku: 'TCO101-BLK-01', colorCode: 'WHT', sizeCode: '01', shopifySku: 'CCSS25COT-WHT01', linkedToShopify: true }],
    poLines: [{ poNumber: '2362', label: 'Dolce / M', styleNumber: null }], proposed: { styles: ['SFR101 Cleo Sweater'], codes: ['color FLG'] } }
  const lines = styleReportLines(messy)
  assert.match(lines.join('\n'), /1 product has no style number: Dolce\./)
  assert.doesNotMatch(lines.join('\n'), /Old Thing/)
  assert.match(lines.join('\n'), /do not match the format or their style, colour and size: Cleo Tee \/ White \/ 1 TCO101-BLK-01/)
  assert.match(lines.join('\n'), /Shopify still has 1 old-format SKU \(expected/)
  assert.match(lines.join('\n'), /PO 2362 Dolce \/ M/)
  assert.match(lines.join('\n'), /Waiting on Brandon or Cleo: 1 proposed style \(SFR101 Cleo Sweater\) and 1 proposed code \(color FLG\)/)
})

test('the partner reference explains a SKU from a real one, and says nothing internal', async () => {
  const { howToRead } = await import('../lib/style-reference')
  const lines = howToRead('HBN101-CHP-PT').join(' ')
  assert.match(lines, /HBN101-CHP-PT is style HBN101, colour CHP, size PT/)
  assert.doesNotMatch(lines, /cost|price|stock|\$|on hand/i)
  assert.match(howToRead(null)[0], /TCO101-BLK-01/)
})

// assign_skus after a colourway is recoded (12 Oct 2026: the Cosmo Tee went
// from RST to CST and kept TCC101-RST-0x while reporting nothing).
const codes: Record<string, string> = { 'COLOR:RST': 'CONFIRMED', 'COLOR:CST': 'CONFIRMED', 'COLOR:NEW': 'PROPOSED', 'SIZE:01': 'CONFIRMED', 'SIZE:02': 'CONFIRMED' }
const codeStatus = (t: 'COLOR' | 'SIZE', c: string) => codes[`${t}:${c}`] ?? null
const sizeFor = (s: string | null) => (s ? `0${s}` : null)
const cosmo = (size: string, over: Partial<SkuVariant> = {}): SkuVariant => ({
  id: `v${size}`, label: `Red Stripe / ${size}`, newSku: `TCC101-RST-0${size}`, colorCode: 'RST', sizeCode: `0${size}`, size,
  colorwayCode: 'CST', shopifySku: `TCC101-RST-0${size}`, ...over,
})

test('a recoded colourway rebuilds its variants\' SKUs once the new code is confirmed, and says Shopify still differs', () => {
  const steps = planSkus('TCC101', [cosmo('1'), cosmo('2')], codeStatus, new Set(), sizeFor)
  assert.deepEqual(steps.map((s) => s.kind === 'set' ? [s.from, s.sku, s.shopifySku] : s.kind), [
    ['TCC101-RST-01', 'TCC101-CST-01', 'TCC101-RST-01'],
    ['TCC101-RST-02', 'TCC101-CST-02', 'TCC101-RST-02'],
  ])
})

test('a recode waiting on an unconfirmed code is reported with the SKU it still reads, never skipped silently', () => {
  const [s] = planSkus('TCC101', [cosmo('1', { colorwayCode: 'NEW' })], codeStatus, new Set(), sizeFor)
  assert.equal(s.kind, 'wait')
  assert.match((s as { why: string }).why, /NEW is not confirmed yet\. It still reads TCC101-RST-01\./)
})

test('SKUs that match their colourway are kept; missing ones are filled; a taken SKU is refused', () => {
  const steps = planSkus('TCO101', [
    { id: 'a', label: 'Black / 1', newSku: 'TCO101-RST-01', colorCode: 'RST', sizeCode: '01', size: '1', colorwayCode: 'RST', shopifySku: null },
    { id: 'b', label: 'Black / 2', newSku: null, colorCode: null, sizeCode: null, size: '2', colorwayCode: 'RST', shopifySku: null },
    { id: 'c', label: 'Black / 1 again', newSku: null, colorCode: null, sizeCode: null, size: '1', colorwayCode: 'RST', shopifySku: null },
  ], codeStatus, new Set(), sizeFor)
  assert.deepEqual(steps.map((s) => s.kind), ['keep', 'set', 'wait'])
  assert.equal((steps[1] as { sku: string }).sku, 'TCO101-RST-02')
  assert.match((steps[2] as { why: string }).why, /already used/)
})

test('a variant with no colourway code is never recoded', () => {
  const [s] = planSkus('TCC101', [cosmo('1', { colorwayCode: null })], codeStatus, new Set(), sizeFor)
  assert.deepEqual(s, { kind: 'keep', sku: 'TCC101-RST-01' })
})
