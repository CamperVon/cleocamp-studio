import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitCatalog, catalogStats, STABLE_SECTIONS } from '../lib/mouse/context'
import { systemBlocks, CATALOG_HEADING } from '../lib/mouse/cache-blocks'

// A catalogue shaped like buildCatalog's output: sections pushed as "\n## X"
// and joined with "\n", in its real order. Every value here is synthetic.
function catalog(live: { date: string; onHand: number; note: string; todo: string }) {
  return [
    `## Today\n${live.date}, Los Angeles time.\n`,
    '## Where these numbers come from',
    'Shopify is connected.',
    '\n## Products',
    `- Test Tee [prd_t] · ${live.onHand} on hand`,
    '\n## Components',
    `- Test button [cmp_b] · ${live.onHand * 10} at Studio`,
    '\n## Places',
    '- Studio [loc_s] — the studio itself, the default place',
    '\n## Vendors',
    '- Test Mill [vnd_m] · SUPPLIER · email: mill@example.test',
    '\n## Open purchase orders',
    `- PO 9001 · Test Mill · SENT · ${live.onHand} pcs`,
    '\n## Wholesale stores on file',
    '- Test Shop [ws_1] · STORE · email shop@example.test · address 1 Test St',
    '\n## Notes you have written',
    `- ${live.note}`,
    '\n## People',
    '- Test Person — tester',
    '\n## Money, as last recorded',
    `- Cash $${live.onHand}`,
    '\n## What every printed document currently says',
    '- Bill to: Test Co',
    '\n## Open questions and todos',
    `- ${live.todo}`,
  ].join('\n')
}
const a = catalog({ date: 'Tuesday, October 6, 2026', onHand: 12, note: 'Rate is $5.50 per sq ft.', todo: 'Order labels' })
const b = catalog({ date: 'Wednesday, October 7, 2026', onHand: 9, note: 'Rate is $6.00 per sq ft — corrected.', todo: 'Order labels, due Thursday' })

test('stable content is byte-identical when only live data changes', () => {
  assert.equal(splitCatalog(a).stable, splitCatalog(b).stable)
  assert.notEqual(splitCatalog(a).live, splitCatalog(b).live)
})

test('nothing is added, dropped or changed: every section keeps its exact text', () => {
  for (const t of [a, b]) {
    const p = splitCatalog(t)
    assert.equal(p.sections.map((s) => s.text).join(''), t)
    assert.equal(p.stable.length + p.live.length, t.length)
    const sorted = (xs: string[]) => [...xs].sort()
    assert.deepEqual(sorted([...p.sections.filter((s) => s.stable), ...p.sections.filter((s) => !s.stable)].map((s) => s.text)), sorted(p.sections.map((s) => s.text)))
  }
})

test('notes, date, counts, orders, money and to-dos are live; only the allowlist is stable', () => {
  const p = splitCatalog(a)
  for (const h of ['Today', 'Where these numbers come from', 'Products', 'Components', 'Open purchase orders', 'Notes you have written', 'Money, as last recorded', 'Open questions and todos']) {
    assert.equal(p.sections.find((s) => s.heading === h)?.stable, false, h)
  }
  assert.ok(p.live.includes('Rate is $5.50 per sq ft.'))
  assert.ok(p.live.includes('October 6, 2026'))
  assert.ok(!p.stable.includes('October 6, 2026'))
  assert.deepEqual(p.sections.filter((s) => s.stable).map((s) => s.heading).sort(), [...STABLE_SECTIONS].sort())
})

test('sections keep their order within each block', () => {
  const p = splitCatalog(a)
  assert.deepEqual(p.sections.filter((s) => s.stable).map((s) => s.heading), ['Places', 'Vendors', 'Wholesale stores on file', 'People', 'What every printed document currently says'])
  assert.deepEqual(p.sections.filter((s) => !s.stable).map((s) => s.heading), ['Today', 'Where these numbers come from', 'Products', 'Components', 'Open purchase orders', 'Notes you have written', 'Money, as last recorded', 'Open questions and todos'])
})

test('a note line that looks like a heading stays live, and an unknown heading is live', () => {
  const t = a.replace('- Rate is $5.50 per sq ft.', '- Rate is $5.50 per sq ft.\n## Vendors said otherwise')
  const p = splitCatalog(t)
  assert.equal(p.sections.map((s) => s.text).join(''), t)
  // A line starting "## Vendors" inside notes would look stable; it is a
  // second "Vendors" chunk only if it matches exactly, so check it never
  // drags live text into the stable block when the heading differs.
  assert.ok(!p.stable.includes('said otherwise'))
  assert.equal(splitCatalog('## Something new\n- x\n').sections[0].stable, false)
  assert.equal(splitCatalog('preamble\n## Places\n- p\n').sections[0].stable, false)
})

test('system blocks: rules 1h, stable 1h, live 5m; at most 4 marks, longer TTLs first', () => {
  const p = splitCatalog(a)
  const blocks = systemBlocks({ rules: 'RULES', extraRules: 'EXTRA', catalog: p })
  const marks = blocks.filter((x) => x.cache_control)
  assert.ok(marks.length <= 4)
  assert.deepEqual(marks.map((x) => (x.cache_control as { ttl?: string }).ttl ?? '5m'), ['1h', '1h', '5m'])
  assert.equal(blocks[0].text, 'RULES')
  assert.equal(blocks[1].text, 'EXTRA')
  assert.equal(blocks[2].text, CATALOG_HEADING + p.stable)
  assert.equal(blocks[3].text, p.live)
  // Everything Mouse used to read is still there, heading once.
  const all = blocks.map((x) => x.text).join('')
  assert.equal(all.split(CATALOG_HEADING).length, 2)
  for (const s of p.sections) assert.ok(all.includes(s.text))
})

test('system blocks without a catalogue, or with no stable sections', () => {
  assert.deepEqual(systemBlocks({ rules: 'R' }).map((x) => x.text), ['R'])
  const onlyLive = systemBlocks({ rules: 'R', catalog: { stable: '', live: '## Today\nx\n' } })
  assert.equal(onlyLive.length, 2)
  assert.equal(onlyLive[1].text, CATALOG_HEADING + '## Today\nx\n')
  assert.equal((onlyLive[1].cache_control as { ttl?: string }).ttl, undefined)
})

test('the usage stats hold sizes and hashes, never the text', () => {
  const s = catalogStats(splitCatalog(a))
  const json = JSON.stringify(s)
  assert.ok(!json.includes('5.50'))
  assert.ok(!json.includes('example.test'))
  assert.equal(s.stable.hash, catalogStats(splitCatalog(b)).stable.hash)
  assert.notEqual(s.live.hash, catalogStats(splitCatalog(b)).live.hash)
  assert.deepEqual(s.blocks, { stable: true, live: true })
  assert.equal(s.sections.reduce((n, x) => n + x.bytes, 0), Buffer.byteLength(a, 'utf8'))
})

test('a note line that exactly matches a stable heading puts everything live (fail safe)', () => {
  const t = a.replace('- Rate is $5.50 per sq ft.', '- Rate is $5.50 per sq ft.\n\n## Vendors\nsome note text')
  const p = splitCatalog(t)
  assert.equal(p.stable, '')
  assert.equal(p.live, t)
})

// Every heading buildCatalog can emit, read from its source so a section
// added later is covered without editing this test. Section names only.
import { readFileSync } from 'node:fs'
function emittedHeadings(): string[] {
  // The notes section's heading lives in lib/mouse/notes.ts since phase 2A.
  const src = ['../lib/mouse/context.ts', '../lib/mouse/notes.ts'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n')
  const fromPushes = src.split('\n')
    .filter((l) => l.includes('L.push(') || /^\s*'\\n## /.test(l))
    .flatMap((l) => [...l.matchAll(/(?<!#)## ([^`'\\\n]+?)(?:\\n|['`])/g)].map((m) => m[1].trim()))
    .filter((h) => !h.includes('${'))
  // The stylists section is pushed as '\n## ' + stylistContext(), whose first line is fixed.
  const st = readFileSync(new URL('../lib/stylists.ts', import.meta.url), 'utf8').match(/'(STYLISTS[^']*)'/)?.[1]
  return [...new Set([...fromPushes, ...(st ? [st] : [])])]
}

test('every section the catalogue can emit still appears, and notes are live', () => {
  const heads = emittedHeadings()
  assert.ok(heads.length >= 20, `found ${heads.length} headings`)
  assert.ok(heads.includes('Notes you have written'))
  const t = heads.map((h, k) => `${k ? '\n' : ''}## ${h}\n- body of ${h}`).join('\n')
  const p = splitCatalog(t)
  const blocks = systemBlocks({ rules: 'R', catalog: p })
  const all = blocks.map((x) => x.text).join('')
  for (const h of heads) {
    assert.ok(all.includes(`## ${h}\n- body of ${h}`), `missing: ${h}`)
    assert.equal(p.sections.find((s) => s.heading === h)?.stable, STABLE_SECTIONS.includes(h), h)
  }
  assert.equal(p.sections.find((s) => s.heading === 'Notes you have written')?.stable, false)
  assert.ok(p.live.includes('- body of Notes you have written'))
  assert.ok(!p.stable.includes('Notes you have written'))
  // Every stable heading is one the catalogue really emits.
  for (const h of STABLE_SECTIONS) assert.ok(heads.includes(h), `stable heading not emitted: ${h}`)
})

test('### sub-headings (each product, each note subject) never split a section', () => {
  const t = '## Products\n### Test Tee [prd_t]\n- 12 on hand\n\n## Notes you have written\n### Test Mill [vnd_m]\n- a note\n\n## Vendors\n- Test Mill\n'
  const p = splitCatalog(t)
  assert.deepEqual(p.sections.map((x) => x.heading), ['Products', 'Notes you have written', 'Vendors'])
  assert.ok(p.live.includes('### Test Mill [vnd_m]\n- a note'))
  assert.equal(p.stable, '## Vendors\n- Test Mill\n')
})
