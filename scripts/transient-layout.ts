/**
 * The exact prompt layouts, before and after, captured from the real code
 * path without calling Anthropic (transient-state review build, 16 Oct 2026).
 *
 *   npx tsx scripts/transient-layout.ts [outDir]
 *
 * Points the Anthropic SDK at a local server that records each request body
 * runAgent sends and answers with scripted replies: first a call to
 * open_record, then a short final answer. The same practice turn (a short
 * history, then a message naming a product) runs once in each layout:
 *
 *   live-tail   what production runs: notes and catalogue as an index, the
 *               live tail on (MOUSE_CATALOG_INDEX=1, MOUSE_CACHE_LIVE_TAIL=1)
 *   transient   the cached core and a fresh business state per request
 *
 * Prints, per request: every system block (size, cache mark), every message
 * (role, blocks, size, cache marks) and where the state sits; and checks the
 * layout's promises: the state is in every request of the turn (the tool
 * follow-up too), after the last mark, never in an earlier message, and not
 * in what the turn hands back to be saved. Writes each captured request body
 * in full to outDir (default: a temp folder) for a person to read. Those
 * files hold real business data: they are for review, not for the repo.
 *
 * Spends nothing. Writes zero-token usage rows under the source
 * "transient-layout-dryrun", and nothing else: practice stops every tool
 * that would change something.
 */
process.env.EMAIL_DRY_RUN = '1'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

type Captured = { system: Array<{ text: string; cache_control?: { ttl?: string } }>; messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>; tools: unknown[] }

async function main() {
  const outDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'transient-layout-'))
  mkdirSync(outDir, { recursive: true })
  const bodies: Captured[] = []
  let calls = 0
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw) as Captured
      bodies.push(body)
      calls++
      const hasToolResult = body.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'))
      const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      const reply = hasToolResult
        ? { id: `msg_dry_${calls}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Practice: (dry run) answered.' }], usage }
        : { id: `msg_dry_${calls}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `toolu_dry_${calls}`, name: 'open_record', input: { ref: 'section: purchase orders' } }], usage }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.ANTHROPIC_API_KEY = 'dry-run-not-a-key'

  const { db } = await import('@/lib/db')
  const { runAgent } = await import('@/lib/mouse/agent')
  const product = await db.product.findFirst({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { name: true } })
  const message = `How many ${product?.name ?? 'Cleo Tee'} do we have, and is anything on order for it?`
  const history = [
    { role: 'user' as const, content: 'Morning. Anything urgent?' },
    { role: 'assistant' as const, content: 'Two things: the tape is short and PO 2409 is still a draft.' },
  ]

  const summaries: Record<string, string[]> = {}
  for (const layout of ['live-tail', 'transient'] as const) {
    const from = bodies.length
    process.env.MOUSE_CATALOG_INDEX = '1'
    const r = await runAgent({
      instruction: message, source: 'transient-layout-dryrun', practice: true, fromAPerson: true,
      notes: 'index', catalog: 'index', chatThreadId: `dryrun_${layout}`, history,
      liveTail: layout === 'live-tail',
      ...(layout === 'transient' ? { transient: { message, access: { actorName: 'Brandon', inventoryWrites: false, shopifyWrites: false } } } : {}),
    })
    const mine = bodies.slice(from)
    const L: string[] = [`=== ${layout}: ${mine.length} requests; reply "${r.text.slice(0, 60)}" ===`]
    mine.forEach((b, i) => {
      writeFileSync(join(outDir, `${layout}-request-${i + 1}.json`), JSON.stringify(b, null, 2))
      L.push(`-- request ${i + 1}`)
      L.push(`   tools: ${b.tools.length} definitions, ${JSON.stringify(b.tools).length} chars (cached ahead of the system prompt)`)
      b.system.forEach((s, k) => L.push(`   system[${k}] ${String(s.text.length).padStart(6)} chars  ${s.cache_control ? `MARK ${s.cache_control.ttl ?? '5m'}` : 'no mark'}  "${s.text.slice(0, 50).replace(/\n/g, ' ')}…"`))
      b.messages.forEach((m, k) => {
        const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
        const desc = blocks.map((x) => {
          const size = JSON.stringify(x).length
          const mark = (x as { cache_control?: { ttl?: string } }).cache_control ? ` MARK ${(x as { cache_control: { ttl?: string } }).cache_control.ttl ?? '5m'}` : ''
          const state = typeof x.text === 'string' && x.text.startsWith('<business_state') ? ' STATE' : ''
          return `${x.type}(${size})${mark}${state}`
        }).join(', ')
        L.push(`   messages[${k}] ${m.role.padEnd(9)} ${desc}`)
      })
    })
    summaries[layout] = L
  }
  server.close()

  // The layout's promises, checked on what was actually sent.
  const checks: Array<[string, boolean]> = []
  const transientBodies = bodies.slice(bodies.length / 2)
  const stateIn = (b: Captured) => b.messages.map((m) => (Array.isArray(m.content) ? m.content : []).filter((x) => typeof x.text === 'string' && (x.text as string).startsWith('<business_state')).length)
  checks.push(['transient: the state is in every request of the turn, tool follow-up included', transientBodies.length >= 2 && transientBodies.every((b) => stateIn(b).reduce((a, n) => a + n, 0) === 1)])
  checks.push(['transient: only in the last message, as its last block', transientBodies.every((b) => { const s = stateIn(b); const last = b.messages[b.messages.length - 1]; return s[s.length - 1] === 1 && Array.isArray(last.content) && String((last.content[last.content.length - 1] as { text?: string }).text ?? '').startsWith('<business_state') })])
  checks.push(['transient: at most 4 cache marks, none after the state', transientBodies.every((b) => {
    const sys = b.system.filter((s) => s.cache_control).length
    const msgMarks = b.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((x) => x.cache_control).length
    const last = b.messages[b.messages.length - 1]
    const lastBlock = Array.isArray(last.content) ? last.content[last.content.length - 1] : null
    return sys + msgMarks <= 4 && !(lastBlock as { cache_control?: unknown } | null)?.cache_control
  })])
  checks.push(['transient: no business data in the system prompt beyond the stable core', transientBodies.every((b) => !b.system.some((s) => /## (Products|Components|Open purchase orders|Notes you have written|Open questions and todos)\n/.test(s.text)))])
  checks.push(['live-tail: unchanged shape (catalogue in the system prompt, no state)', bodies.slice(0, bodies.length / 2).every((b) => b.system.some((s) => s.text.includes('## Products')) && stateIn(b).every((n) => n === 0))])

  for (const L of Object.values(summaries)) console.log(L.join('\n') + '\n')
  console.log('=== Checks on the captured requests ===')
  for (const [c, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${c}`)
  console.log(`\nFull request bodies: ${outDir}`)
  await db.$disconnect()
  return checks.every(([, ok]) => ok)
}

main().then((ok) => process.exit(ok ? 0 : 1), (e) => { console.error(e); process.exit(2) })
