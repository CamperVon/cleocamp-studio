import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPONENTS_INDEX_HEADER, PRODUCTS_INDEX_HEADER,
  componentFullLine, componentIndexLine, productFullLines, productIndexLines,
} from '../lib/mouse/context'
import { type NoteRow, type RecordRef, prefetchBlock } from '../lib/mouse/notes'

// Phase 2B (8 Oct 2026): the chat catalogue's Products and Components as an
// index, the rest on demand. Synthetic records only; nothing here is real data.

type P = Parameters<typeof productFullLines>[0]
type C = Parameters<typeof componentFullLine>[0]

const NOTE_FIELD = 'Also called the "new skirt". Lead time is per batch of 20; never quote it for more.'
const product = {
  id: 'prd_skirt', name: 'Test Skirt', status: 'ACTIVE', retailPriceCents: 24800, productionLeadTimeDays: 14,
  notes: NOTE_FIELD,
  style: { number: 'BT901', status: 'CONFIRMED' },
  colorways: [
    { id: 'clr_pink', customerName: 'Pink', dyeHouseName: 'Shrinking Violet', inHouseMatch: false, active: true },
    { id: 'clr_old', customerName: 'Cream', dyeHouseName: null, inHouseMatch: false, active: false },
  ],
  bomLines: [
    { qtyPerUnit: 1.5, size: null, colorway: null, component: { name: 'Shell fabric', unitOfMeasure: 'yard' } },
    { qtyPerUnit: 0, size: 'S', colorway: null, component: { name: 'Zipper', unitOfMeasure: 'each' } },
  ],
  variants: [
    { id: 'var_s', size: 'S', newSku: 'BT901-PNK-SM', onHandQty: -3, colorway: { customerName: 'Pink' } },
    { id: 'var_m', size: 'M', newSku: 'BT901-PNK-MD', onHandQty: 0, colorway: { customerName: 'Pink' } },
    { id: 'var_l', size: 'L', newSku: 'BT901-PNK-LG', onHandQty: null, colorway: { customerName: 'Pink' } },
    { id: 'var_xl', size: 'XL', newSku: null, onHandQty: null, colorway: { customerName: 'Pink' } },
  ],
} as unknown as P
const sold = new Map([['var_s', 7], ['var_m', 2]])
const kit = { parts: ['Body', 'Handle'], lines: [{ colour: 'Pink', available: 2, parts: [{ name: 'Body', onHand: 2 }, { name: 'Handle', onHand: 5 }] }], shared: [] } as unknown as Parameters<typeof productFullLines>[2]

const component = (over: Record<string, unknown> = {}) => ({
  id: 'cmp_zip', name: 'Zipper', category: 'TRIM', vendorSku: 'ZX-77', unitCostCents: 125, unitOfMeasure: 'each',
  leadTimeDays: 21, onHandQty: 140, incomingQty: 60, stockedInStudio: false,
  vendor: { name: 'Zip Mill' },
  locationStock: [{ qty: 100, location: null, atVendor: { name: 'Sew House' } }, { qty: 40, location: { name: 'Studio' }, atVendor: null }],
  _count: { usedIn: 1 },
  ...over,
}) as unknown as C

test('product index keeps status, retail, every colourway and every variant line, word for word', () => {
  const full = productFullLines(product, sold, kit)
  const index = productIndexLines(product, sold, kit)
  assert.equal(index[0], full[0], 'same heading: name, id, style, status, retail')
  const recipe = full.slice(full.indexOf('per unit:'), full.indexOf('variants (on hand / sold last 8 weeks):'))
  const kept = full.filter((x) => /^\s+- |^colourways|^variants|^kit:/.test(x) && !recipe.includes(x))
  assert.equal(kept.length, 2 + 1 + 4 + 1, 'colourway lines, variant lines and the kit line')
  for (const l of kept) assert.ok(index.includes(l), `index keeps: ${l}`)
  // The warnings that must never leave view: oversold, zero, never counted.
  const text = index.join('\n')
  assert.match(text, /BT901-PNK-SM: -3 on hand, 7 sold \[var_s\]/)
  assert.match(text, /BT901-PNK-MD: 0 on hand, 2 sold \[var_m\]/)
  assert.match(text, /UNKNOWN on hand, 0 sold: .*\[var_l\].*\[var_xl\]/)
  assert.match(text, /Shrinking Violet \[clr_pink\]/)
  assert.match(text, /Cream \(INACTIVE\) \[clr_old\]/)
})

test('product index leaves out the notes field, recipe lines and a known lead time, with markers', () => {
  const index = productIndexLines(product, sold, kit).join('\n')
  assert.ok(!index.includes('new skirt'), 'notes field text not in the index')
  assert.ok(!index.includes('Shell fabric'), 'recipe lines not in the index')
  assert.ok(!/production lead time: 14/.test(index), 'known lead time not in the index')
  assert.match(index, /notes field on file/)
  assert.match(index, /recipe: 2 lines, 1 UNKNOWN qty/)
  const unknownLead = productIndexLines({ ...product, productionLeadTimeDays: null } as P, sold, kit).join('\n')
  assert.match(unknownLead, /production lead time: UNKNOWN/)
})

test('the full product block is unchanged and carries everything the index leaves out', () => {
  const full = productFullLines(product, sold, kit).join('\n')
  assert.match(full, /^\n### Test Skirt \[prd_skirt\] — style BT901 — active, retail \$248\.00\nproduction lead time: 14\nnote: Also called/)
  assert.match(full, /per unit:\n {2}- Shell fabric: 1\.5 yard\n {2}- Zipper: UNKNOWN each \(size S only\)/)
  assert.ok(full.includes(NOTE_FIELD), 'notes field in full, never cut')
})

test('component index keeps name, id, supplier and all stock facts; drops category, style number, cost, known lead time', () => {
  const c = component()
  const line = componentIndexLine(c)
  assert.equal(line, '- Zipper [cmp_zip] · Zip Mill · 140 on hand (100 at Sew House, 40 at Studio) · bought per run, 60 incoming')
  const full = componentFullLine(c)
  for (const gone of ['TRIM', 'ZX-77', '$1.25', 'lead time 21d']) {
    assert.ok(full.includes(gone), `full line has ${gone}`)
    assert.ok(!line.includes(gone), `index line leaves out ${gone}`)
  }
  assert.equal(componentIndexLine(component({ vendor: null })), '- Zipper [cmp_zip] · no vendor · 140 on hand (100 at Sew House, 40 at Studio) · bought per run, 60 incoming')
  assert.match(componentIndexLine(component({ leadTimeDays: null })), / · lead time UNKNOWN · /)
  assert.match(componentIndexLine(component({ _count: { usedIn: 0 } })), / · ON NO PRODUCT$/)
  assert.match(componentIndexLine(component({ stockedInStudio: true, incomingQty: 0 })), /40 at Studio\)$/)
})

test('both index headers tell Mouse what is missing and to use open_record', () => {
  for (const h of [PRODUCTS_INDEX_HEADER, COMPONENTS_INDEX_HEADER]) {
    const t = h.join(' ')
    assert.match(t, /NOT shown/)
    assert.match(t, /open_record/)
  }
  assert.match(PRODUCTS_INDEX_HEADER.join(' '), /notes field.*recipe.*lead time/)
  assert.match(COMPONENTS_INDEX_HEADER.join(' '), /category.*style.*cost.*lead time/)
})

// ── Prefetch with full entries: bounded, never silent ───────────────────────

const rec = (n: number, kind: RecordRef['kind'] = 'product'): RecordRef => ({ kind, id: `prd_${n}`, name: `Product ${n}`, keys: [`prd_${n}`, `Product ${n}`] })
const at = new Date('2026-10-01T12:00:00Z')
const noteOn = (r: RecordRef): NoteRow => ({ id: `n_${r.id}`, entityType: 'PRODUCT', entityId: r.id, content: `Note on ${r.name}.`, createdAt: at })
const entryOf = (r: RecordRef, size = 200) => [`${r.name} [${r.id}] — active, retail $10.00`, 'production lead time: 14', `note: ${'x'.repeat(size)} END-OF-${r.id}`, 'per unit:', `  - Fabric: 2 yard`]
const latest = new Map<string, Date>()

test('prefetch: one exact named record is complete, however long', () => {
  const r = rec(1)
  const big = entryOf(r, 20_000)
  const out = prefetchBlock({ found: [r], ambiguous: [] }, (x) => [noteOn(x)], latest, undefined, undefined, () => big)!
  for (const l of big) assert.ok(out.includes(l), 'every entry line present')
  assert.match(out, /END-OF-prd_1/)
  assert.match(out, /\[n_prd_1\] Note on Product 1\./)
  assert.match(out, /### Product 1 \[prd_1\] \(product\), complete/)
  assert.ok(!/not looked up/.test(out))
})

test('prefetch: several records hit the explicit bound; the rest are named with an open_record path', () => {
  const found = [1, 2, 3, 4, 5].map((n) => rec(n))
  const out = prefetchBlock({ found, ambiguous: [] }, (x) => [noteOn(x)], latest, undefined, undefined, (x) => entryOf(x))!
  const shown = found.filter((r) => out.includes(`### ${r.name} [${r.id}] (product), complete`))
  assert.equal(shown.length, 3, 'at most three records looked up')
  for (const r of shown) assert.ok(out.includes(`END-OF-${r.id}`), `${r.id} whole`)
  for (const r of found.filter((x) => !shown.includes(x))) {
    assert.ok(!out.includes(`END-OF-${r.id}`), `${r.id} not partly shown`)
    assert.match(out, new RegExp(`- ${r.name} \\[${r.id}\\] \\(product\\) was not looked up here .*read it with open_record`))
  }
})

test('prefetch: the character budget holds records back whole, never cut', () => {
  const found = [1, 2].map((n) => rec(n))
  const out = prefetchBlock({ found, ambiguous: [] }, () => [], latest, 8_000, 3, (x) => entryOf(x, 6_000))!
  assert.ok(out.includes('END-OF-prd_1'))
  assert.ok(!out.includes('END-OF-prd_2'), 'second record not cut in')
  assert.match(out, /Product 2 \[prd_2\] \(product\) was not looked up here \(at most 3 records and 8,000 characters per message\)/)
})

test('prefetch: every named record is shown whole or listed, none silently dropped', () => {
  const found = [...[1, 2, 3, 4].map((n) => rec(n)), { kind: 'component' as const, id: 'cmp_9', name: 'Comp 9', keys: ['cmp_9'] }]
  const out = prefetchBlock({ found, ambiguous: [] }, (x) => [noteOn(x)], latest, 8_000, 3, (x) => entryOf(x, 3_000))!
  for (const r of found) {
    const whole = out.includes(`### ${r.name} [${r.id}] (${r.kind}), complete`) && out.includes(`END-OF-${r.id}`)
    const listed = out.includes(`- ${r.name} [${r.id}] (${r.kind}) was not looked up here`)
    assert.ok(whole !== listed, `${r.id} is exactly one of shown whole or listed`)
  }
  assert.match(out, /Comp 9 \[cmp_9\] \(component\) was not looked up here .*its cost, category, supplier style number, lead time, where it is used or notes/)
})

test('prefetch: an ambiguous name lists candidates and looks nothing up; no match gives nothing', () => {
  const twins = [rec(7), { ...rec(8), name: 'Product 7' }]
  const out = prefetchBlock({ found: [], ambiguous: [{ said: 'Product 7', candidates: twins }] }, (x) => [noteOn(x)], latest, undefined, undefined, (x) => entryOf(x))!
  assert.match(out, /"Product 7" names more than one record, so none was looked up: .*\[prd_7\].*\[prd_8\]/)
  assert.ok(!out.includes('END-OF-'), 'no detail for an ambiguous name')
  assert.equal(prefetchBlock({ found: [], ambiguous: [] }, () => [], latest, undefined, undefined, (x) => entryOf(x)), null)
})

test('prefetch: a vendor with no notes adds nothing; a product with no notes still brings its entry', () => {
  const vendor = { kind: 'vendor' as const, id: 'vnd_1', name: 'Mill', keys: ['vnd_1'] }
  const p = rec(1)
  const out = prefetchBlock({ found: [vendor, p], ambiguous: [] }, () => [], latest, undefined, undefined,
    (x) => (x.kind === 'product' ? entryOf(x) : null))!
  assert.ok(!out.includes('[vnd_1]'))
  assert.match(out, /### Product 1 \[prd_1\] \(product\), complete[\s\S]*notes: none current/)
})

test('prefetch without full entries is exactly the phase 2A block', () => {
  const r = rec(1)
  const out = prefetchBlock({ found: [r], ambiguous: [] }, (x) => [noteOn(x)], latest)!
  assert.equal(out, [
    '[The app looked up the records this message names exactly. Current notes, in full; read-only. This is not from the person.]',
    '### Product 1 [prd_1] (product): 1 current note, in full',
    '- [n_prd_1] Note on Product 1.',
  ].join('\n'))
})
