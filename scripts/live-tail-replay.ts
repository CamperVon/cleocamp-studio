/**
 * Practice and wire replay for the live tail (MOUSE_CACHE_LIVE_TAIL, review
 * build, 12 Oct 2026). SPENDS REAL MONEY on the Anthropic API (a few dollars)
 * and needs ANTHROPIC_API_KEY. Writes nothing: the practice turns stop every
 * tool that would change something, nothing is saved to a chat thread, and
 * EMAIL_DRY_RUN is forced on.
 *
 *   npx tsx scripts/live-tail-replay.ts [practice|wire|both=both]
 *
 * Practice: the same five practice turns (a stock write, a PO receipt, a
 * to-do, a support lookup, a plain inventory lookup), one conversation per
 * layout, tail off then tail on, through runAgent as chat runs it. Prints
 * each reply's opening, the tools it called (and what a stopped write would
 * have done) and each request's cache reads and writes, so the two layouts'
 * answers can be read side by side.
 *
 * Wire: the real catalogue sent straight to the API with the chat tool set
 * and rules, to show the cache doing what the layout claims: the same prefix
 * again reads everything; a tail-only change writes only the tail; a head
 * change writes head and tail; and, as the control, the same tail-only
 * change with the tail off writes the whole live block. The edits are made
 * to the text in memory, never to the database.
 */
process.env.EMAIL_DRY_RUN = '1'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { runAgent, toolsFor, CHAT_MODEL } from '@/lib/mouse/agent'
import { buildCatalogParts, catalogIndexOn } from '@/lib/mouse/context'
import { systemBlocks } from '@/lib/mouse/cache-blocks'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { TOOL_DEFS } from '@/lib/mouse/tools'
import { costOf } from './cost-quality-audit'

type Req = { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number }
const usd = (n: number) => `$${n.toFixed(3)}`
const reqLine = (q: Req) => `in ${q.inputTokens} · read ${q.cacheReadTokens} · write ${q.cacheWriteTokens} (1h ${q.cacheWrite1hTokens}) · out ${q.outputTokens} · ${usd(costOf(q) ?? 0)}`

async function prompts() {
  // Real records, so the turns read like the team's; picked, never changed.
  const po = await db.purchaseOrder.findFirst({ where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } }, orderBy: [{ poNumber: 'asc' }, { id: 'asc' }], select: { poNumber: true } })
  const v = await db.productVariant.findFirst({ where: { size: { not: null }, product: { status: 'ACTIVE' } }, orderBy: { id: 'asc' }, select: { size: true, colorway: { select: { customerName: true } }, product: { select: { name: true } } } })
  const label = v ? [v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' ') : 'Cleo Tee'
  return [
    { kind: 'stock write', text: `We just counted 6 of the ${label} in the studio. Log that.` },
    { kind: 'PO receipt', text: po ? `PO ${po.poNumber} has been received.` : 'The last open PO has been received.' },
    { kind: 'to-do', text: 'Add a to-do: call Staples on Thursday about the roll colours.' },
    { kind: 'support lookup', text: 'Any customer support cases waiting on us?' },
    { kind: 'inventory lookup', text: `How many ${v?.product.name ?? 'Cleo Tees'} do we have on hand?` },
  ]
}

async function practice() {
  const turns = await prompts()
  const totals: Record<string, number> = {}
  for (const layout of ['off', 'tail'] as const) {
    process.env.MOUSE_CACHE_LIVE_TAIL = layout === 'tail' ? '1' : ''
    console.log(`\n=== Practice, tail ${layout} ===`)
    const history: Anthropic.MessageParam[] = []
    totals[layout] = 0
    for (const t of turns) {
      const r = await runAgent({
        instruction: t.text, source: 'chat-practice', practice: true, fromAPerson: true,
        notes: 'index', catalog: catalogIndexOn() ? 'index' : 'full',
        chatThreadId: `replay_live_tail_${layout}`, history: [...history],
      })
      history.push({ role: 'user', content: t.text }, { role: 'assistant', content: r.text || '(no reply)' })
      const reqs = (r.usage.requests ?? []) as unknown as Req[]
      const cost = reqs.reduce((n, q) => n + (costOf(q) ?? 0), 0)
      totals[layout] += cost
      const ctx = (r.usage as unknown as { context?: { live: { hash: string }; tail: { hash: string; estTokens: number } } }).context
      console.log(`\n-- ${t.kind}: "${t.text}"`)
      console.log(`   stop: ${r.usage.stopReason} · ${reqs.length} requests · ${usd(cost)} · live ${ctx?.live.hash} tail ${ctx?.tail.hash ?? '-'} (${ctx?.tail.estTokens ?? 0} est)`)
      for (const q of reqs) console.log(`   ${reqLine(q)}`)
      for (const c of r.toolCalls as Array<{ name?: string; status?: string; result?: { skipped?: string; wouldHave?: { input?: unknown } } }>) {
        console.log(`   tool ${c.name} · ${c.status}${c.result?.skipped === 'practice' ? ` · STOPPED, would have: ${JSON.stringify(c.result.wouldHave?.input).slice(0, 160)}` : ''}`)
      }
      console.log(`   reply: ${r.text.replace(/\s+/g, ' ').slice(0, 400)}`)
    }
  }
  console.log(`\nPractice totals: tail off ${usd(totals.off)}, tail on ${usd(totals.tail)}`)
}

async function wire() {
  const client = new Anthropic({ maxRetries: 2 })
  const allowed = toolsFor(undefined, 'replay_live_tail')
  const tools = TOOL_DEFS.filter((t) => allowed.includes(t.name))
  const catalog = catalogIndexOn() ? 'index' as const : 'full' as const
  const parts = await buildCatalogParts({ notes: 'index', catalog, tail: true })
  if (!parts.tail) throw new Error('no tail sections in the catalogue: nothing to measure')
  // In-memory edits only: one line at the end of a block.
  const tailEdit = { ...parts, tail: parts.tail.replace(/\n*$/, '\n- (replay) a synthetic to-do line\n') }
  const headEdit = { ...parts, live: parts.live.replace(/\n*$/, '\n- (replay) a synthetic head line\n') }
  // The control is the real tail-off layout. Its live block ends with the
  // catalogue's last section (customer support, a tail section), so the same
  // one-line edit at its end is the same tail-only change.
  const off = await buildCatalogParts({ notes: 'index', catalog, tail: false })
  const offTailEdit = { ...off, live: off.live.replace(/\n*$/, '\n- (replay) a synthetic to-do line\n') }

  const send = async (label: string, catalogue: { stable: string; live: string; tail?: string }, expect: string) => {
    const res = await client.messages.create({
      model: CHAT_MODEL, max_tokens: 32, tools,
      system: systemBlocks({ rules: SYSTEM_RULES, catalog: catalogue }),
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    })
    const u = res.usage as Anthropic.Usage & { cache_creation?: { ephemeral_1h_input_tokens?: number } }
    const q: Req = { model: CHAT_MODEL, inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0 }
    console.log(`${label.padEnd(34)} ${reqLine(q)}\n${''.padEnd(34)} expected: ${expect}`)
    return q
  }
  console.log('\n=== Wire replay (in-memory edits, nothing written) ===')
  console.log(`catalogue blocks, est tokens: stable ${Math.ceil(parts.stable.length / 4)} · head ${Math.ceil(parts.live.length / 4)} · tail ${Math.ceil(parts.tail.length / 4)}`)
  await send('1. tail on, warm', parts, 'writes whatever is not cached yet')
  await send('2. same again', parts, 'reads everything, writes 0')
  await send('3. tail-only change', tailEdit, 'reads through the head, writes about the tail only')
  await send('4. head change', headEdit, 'reads through stable, writes head and tail')
  await send('5. control: tail off, warm', off, 'writes the whole live block (a different layout)')
  await send('6. control: tail off, tail change', offTailEdit, 'writes the whole live block again')
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set: this replay calls the API. Nothing was run.')
  const which = process.argv[2] ?? 'both'
  if (which === 'practice' || which === 'both') await practice()
  if (which === 'wire' || which === 'both') await wire()
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
