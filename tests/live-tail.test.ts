import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import type Anthropic from '@anthropic-ai/sdk'
import {
  splitCatalog, catalogStats, STABLE_SECTIONS, TAIL_SECTIONS, CATALOG_PO_ORDER, CATALOG_RUN_ORDER,
} from '../lib/mouse/context'
import { systemBlocks, CATALOG_HEADING } from '../lib/mouse/cache-blocks'
import { prefixHashes } from '../lib/mouse/cache-diagnostics'
import { runLoop } from '../lib/mouse/runner'

// The live tail (12 Oct 2026, MOUSE_CACHE_LIVE_TAIL=1, review build): the
// sections that change most go last behind a fourth five-minute mark. These
// hold that nothing Mouse reads is added, dropped or changed; that the four
// marks are valid; that a tail-only change leaves the head byte-identical
// and a head change reaches the tail; that no conversation cache is added
// alongside (all four slots are taken); and that the catalogue's order of
// open POs and production runs is fixed. Every value here is synthetic.

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')

// Every heading buildCatalog can emit, read from its source (same reading as
// tests/catalog-split.test.ts), in the order the source pushes them.
function emittedHeadings(): string[] {
  const text = ['../lib/mouse/context.ts', '../lib/mouse/notes.ts'].map(src).join('\n')
  const fromPushes = text.split('\n')
    .filter((l) => l.includes('L.push(') || /^\s*'\\n## /.test(l))
    .flatMap((l) => [...l.matchAll(/(?<!#)## ([^`'\\\n]+?)(?:\\n|['`])/g)].map((m) => m[1].trim()))
    .filter((h) => !h.includes('${'))
  const st = src('../lib/stylists.ts').match(/'(STYLISTS[^']*)'/)?.[1]
  return [...new Set([...fromPushes, ...(st ? [st] : [])])]
}

// A catalogue with every real heading in its real order; `vary` changes the
// body of the named sections only.
function catalog(vary: Record<string, string> = {}) {
  return emittedHeadings().map((h, k) => `${k ? '\n' : ''}## ${h}\n- body of ${h}${vary[h] ? ` · ${vary[h]}` : ''}`).join('\n')
}
const marksOf = (blocks: Anthropic.TextBlockParam[]) => blocks.filter((b) => b.cache_control).map((b) => (b.cache_control as { ttl?: string }).ttl ?? '5m')

test('the tail list names real catalogue sections, none of them stable, and keeps Today and sources at the head', () => {
  const heads = emittedHeadings()
  for (const h of TAIL_SECTIONS) {
    assert.ok(heads.includes(h), `tail heading not emitted: ${h}`)
    assert.ok(!STABLE_SECTIONS.includes(h), h)
  }
  assert.deepEqual([...TAIL_SECTIONS], [
    'Your own forecasts, from the last nightly run', 'Alerts you have raised, still open', 'Calendar, from today onward',
    'Money, as last recorded', 'Scheduled emails', 'Open questions and todos', 'Customer support (support@cleocamp.com)',
  ])
  const p = splitCatalog(catalog(), { tail: true })
  assert.ok(p.live.startsWith('## Today\n'))
  assert.ok(p.live.includes('## Where these numbers come from\n'))
  assert.ok(p.live.includes('## Notes you have written\n'))
})

test('every catalogue heading appears exactly once, with byte-identical text', () => {
  const t = catalog()
  const p = splitCatalog(t, { tail: true })
  assert.equal(p.stable.length + p.live.length + p.tail.length, t.length)
  const all = systemBlocks({ rules: 'R', catalog: p }).map((b) => b.text).join('')
  assert.equal(all.split(CATALOG_HEADING).length, 2, 'the catalogue heading once')
  for (const s of p.sections) {
    assert.equal(all.split(s.text).length, 2, `once: ${s.heading}`)
    assert.equal(all.split(`## ${s.heading}\n`).length, 2, `heading once: ${s.heading}`)
  }
  // The same sections, the same bytes, with the tail off.
  const off = splitCatalog(t)
  assert.deepEqual(off.sections.map((s) => s.text).sort(), p.sections.map((s) => s.text).sort())
  assert.equal(off.tail, '')
  assert.equal(off.live, off.sections.filter((s) => !s.stable).map((s) => s.text).join(''))
})

test('each block keeps the catalogue order, and the tail holds exactly the tail sections', () => {
  const p = splitCatalog(catalog(), { tail: true })
  const order = p.sections.map((s) => s.heading)
  const inOrder = (hs: string[]) => hs.every((h, i) => i === 0 || order.indexOf(hs[i - 1]) < order.indexOf(h))
  const tail = p.sections.filter((s) => s.tail).map((s) => s.heading)
  const head = p.sections.filter((s) => !s.tail && !s.stable).map((s) => s.heading)
  assert.deepEqual([...tail].sort(), [...TAIL_SECTIONS].sort())
  assert.ok(inOrder(tail) && inOrder(head))
  assert.equal(p.tail, p.sections.filter((s) => s.tail).map((s) => s.text).join(''))
})

test('four cache marks, in valid TTL order: rules 1h, stable 1h, live head 5m, live tail 5m', () => {
  const p = splitCatalog(catalog(), { tail: true })
  const blocks = systemBlocks({ rules: 'RULES', extraRules: 'EXTRA', practiceRules: 'PRACTICE', catalog: p })
  assert.deepEqual(marksOf(blocks), ['1h', '1h', '5m', '5m'])
  assert.deepEqual(blocks.map((b) => b.text), ['RULES', 'EXTRA', 'PRACTICE', CATALOG_HEADING + p.stable, p.live, p.tail])
  // No longer TTL after a shorter one.
  const rank = { '1h': 2, '5m': 1 } as const
  marksOf(blocks).forEach((m, i, xs) => assert.ok(i === 0 || rank[m as '1h' | '5m'] <= rank[xs[i - 1] as '1h' | '5m']))
  // Tail off: three marks, exactly as before.
  assert.deepEqual(marksOf(systemBlocks({ rules: 'R', catalog: splitCatalog(catalog()) })), ['1h', '1h', '5m'])
})

test('a tail-only change leaves the head byte-identical', () => {
  const a = splitCatalog(catalog({ 'Open questions and todos': 'Order labels' }), { tail: true })
  const b = splitCatalog(catalog({ 'Open questions and todos': 'Order labels, due Thursday', 'Customer support (support@cleocamp.com)': '3 open' }), { tail: true })
  const ba = systemBlocks({ rules: 'R', catalog: a }), bb = systemBlocks({ rules: 'R', catalog: b })
  // Everything through the live head's mark, the cached prefix, is identical.
  const upToHead = (bs: Anthropic.TextBlockParam[]) => bs.slice(0, bs.length - 1).map((x) => x.text).join('')
  assert.equal(upToHead(ba), upToHead(bb))
  assert.equal(a.live, b.live)
  assert.equal(a.stable, b.stable)
  assert.notEqual(a.tail, b.tail)
  const sa = catalogStats(a), sb = catalogStats(b)
  assert.equal(sa.live.hash, sb.live.hash)
  assert.notEqual(sa.tail.hash, sb.tail.hash)
})

test('a head change reaches the tail: its cached prefix moves though its own text does not', () => {
  const a = splitCatalog(catalog({ Products: '12 on hand' }), { tail: true })
  const b = splitCatalog(catalog({ Products: '9 on hand' }), { tail: true })
  assert.notEqual(a.live, b.live)
  assert.equal(a.tail, b.tail, 'the tail text itself is unchanged')
  const through = (p: typeof a) => systemBlocks({ rules: 'R', catalog: p }).map((x) => x.text).join('')
  assert.notEqual(through(a), through(b), 'the prefix ending at the tail mark differs, so the tail is written again')
  assert.equal(systemBlocks({ rules: 'R', catalog: a })[1].text, systemBlocks({ rules: 'R', catalog: b })[1].text, 'stable still identical')
})

test('a tail heading seen twice keeps everything at the head (fail safe)', () => {
  const t = catalog().replace('- body of Notes you have written', '- body of Notes you have written\n## Scheduled emails\n- looks like a section')
  const p = splitCatalog(t, { tail: true })
  assert.equal(p.tail, '')
  assert.equal(p.stable.length + p.live.length, t.length, 'nothing dropped')
  assert.ok(p.sections.every((x) => !x.tail))
})

test('heading placement when blocks are empty', () => {
  const onlyTail = systemBlocks({ rules: 'R', catalog: { stable: '', live: '', tail: '## Scheduled emails\nx\n' } })
  assert.deepEqual(onlyTail.map((b) => b.text), ['R', CATALOG_HEADING + '## Scheduled emails\nx\n'])
  const noHead = systemBlocks({ rules: 'R', catalog: { stable: '## Places\np\n', live: '', tail: '## Scheduled emails\nx\n' } })
  assert.deepEqual(noHead.map((b) => b.text), ['R', CATALOG_HEADING + '## Places\np\n', '## Scheduled emails\nx\n'])
  assert.deepEqual(marksOf(noHead), ['1h', '1h', '5m'])
})

test('no automatic or conversation cache: the request carries the four system marks and no others', async () => {
  const p = splitCatalog(catalog(), { tail: true })
  const seen: Record<string, unknown>[] = []
  const tools: Anthropic.Tool[] = [{ name: 'query_status', input_schema: { type: 'object' } }]
  const toolUse: Anthropic.ToolUseBlock = { type: 'tool_use', caller: { type: 'direct' }, name: 'query_status', id: 't1', input: {} }
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Usage
  let n = 0
  await runLoop({
    system: systemBlocks({ rules: 'R', catalog: p }), tools, model: 'opus',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'How many Test Tees?' }] }],
    execute: async () => ({ ok: true }),
    create: async (req) => {
      seen.push(JSON.parse(JSON.stringify(req)))
      return n++ === 0
        ? { id: 'm1', content: [toolUse], stop_reason: 'tool_use' as const, usage }
        : { id: 'm2', content: [{ type: 'text' as const, text: 'Done.', citations: null }], stop_reason: 'end_turn' as const, usage }
    },
  })
  assert.equal(seen.length, 2, 'a tool round, so the second request carries history')
  for (const req of seen) {
    assert.ok(!('cache_control' in req), 'no top-level (automatic) cache_control')
    const count = (x: unknown) => JSON.stringify(x).split('"cache_control"').length - 1
    assert.equal(count(req.messages), 0, 'no mark in the conversation')
    assert.equal(count(req.tools), 0, 'no mark on the tools')
    assert.equal(count(req.system), 4)
    assert.equal(count(req), 4, 'four marks in all, the API maximum')
  }
})

test('only the cache-blocks layout writes cache_control anywhere in the app', () => {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(e.name) && src(rel).includes('cache_control')) hits.push(rel)
    }
  }
  walk('../lib'); walk('../app')
  assert.deepEqual(hits, ['../lib/mouse/cache-blocks.ts'])
})

test('prefix hashes carry the tail as its own block', () => {
  const a = prefixHashes({ tools: [], rules: 'R', stable: 'S', live: 'L', tail: 'T1' })
  const b = prefixHashes({ tools: [], rules: 'R', stable: 'S', live: 'L', tail: 'T2' })
  assert.equal(a.live, b.live)
  assert.notEqual(a.tail, b.tail)
  assert.equal(prefixHashes({ tools: [], rules: 'R' }).tail, null)
})

test('open POs and production runs have a fixed order in the catalogue', () => {
  assert.deepEqual(CATALOG_PO_ORDER, [{ poNumber: 'asc' }, { id: 'asc' }])
  assert.deepEqual(CATALOG_RUN_ORDER, [{ expectedReadyAt: 'asc' }, { id: 'asc' }])
  // buildCatalog's own queries use them.
  const body = src('../lib/mouse/context.ts')
  const build = body.slice(body.indexOf('export async function buildCatalog('))
  const query = (model: string) => { const i = build.indexOf(`db.${model}.findMany({`); return build.slice(i, build.indexOf('}),', i)) }
  assert.match(query('purchaseOrder'), /orderBy: CATALOG_PO_ORDER/)
  assert.match(query('productionRun'), /orderBy: CATALOG_RUN_ORDER/)
})
