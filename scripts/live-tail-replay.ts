/**
 * Validator for the live tail (MOUSE_CACHE_LIVE_TAIL, review build, 12 Oct
 * 2026). Exits nonzero if any claim fails; the claims and their tolerances
 * are in scripts/live-tail-checks.ts, tested in tests/live-tail-replay.test.ts.
 *
 *   npx tsx scripts/live-tail-replay.ts [practice|wire|both=both]
 *
 * SPENDS REAL MONEY on the Anthropic API (a few dollars) and needs
 * ANTHROPIC_API_KEY; it refuses to start without it.
 *
 * What it changes: operational data (stock, orders, to-dos, notes, support
 * cases, Shopify) and chat history are left untouched. The practice turns
 * stop every tool that would change something and look-ups only read;
 * nothing is saved to a chat thread; EMAIL_DRY_RUN is forced on. Usage
 * accounting IS recorded: every paid request writes a ModelUsage row with
 * source "live-tail-replay", so the spend is visible and never mistaken for
 * chat or practice.
 *
 * Practice: five practice turns (a stock write, a PO receipt, a to-do, a
 * support lookup, a plain inventory lookup), one conversation per layout,
 * tail off then tail on, through runAgent as chatTurn calls it. Checked:
 * each finished with a reply, changed nothing, and ran the layout asked
 * for. The two layouts' replies are printed side by side for a person to
 * compare; that judgement is not automated.
 *
 * Wire: the real catalogue sent straight to the API with the chat tool set
 * and rules; edits are made to the text in memory, never to the database.
 * Checked: an identical request writes nothing and reads the prefix back; a
 * tail-only change writes less, and costs less, than the same change with
 * the tail off; a head change writes more than a tail-only one; and with
 * the tail off, a one-line change rewrites the whole live block.
 */
process.env.EMAIL_DRY_RUN = '1'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { runAgent, toolsFor, CHAT_MODEL } from '@/lib/mouse/agent'
import { buildCatalogParts, catalogIndexOn } from '@/lib/mouse/context'
import { systemBlocks } from '@/lib/mouse/cache-blocks'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { TOOL_DEFS } from '@/lib/mouse/tools'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import type { RequestUsage } from '@/lib/mouse/runner'
import { costOf } from './cost-quality-audit'
import { checkPractice, checkWire, type Claim, type Measured, type PracticeTurn, type WireRun } from './live-tail-checks'

const SOURCE = 'live-tail-replay'
const usd = (n: number) => `$${n.toFixed(4)}`
const reqLine = (q: RequestUsage) => `in ${q.inputTokens} · read ${q.cacheReadTokens} · write ${q.cacheWriteTokens} (1h ${q.cacheWrite1hTokens}) · out ${q.outputTokens} · ${usd(costOf(q) ?? 0)}`

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

type Call = { name?: string; status?: string; isWrite?: boolean; result?: { skipped?: string; wouldHave?: { input?: unknown } } }

async function practice(): Promise<Claim[]> {
  const turns = await prompts()
  const done: PracticeTurn[] = []
  const replies = new Map<string, Record<'off' | 'tail', string>>()
  for (const layout of ['off', 'tail'] as const) {
    console.log(`\n=== Practice, tail ${layout} ===`)
    const history: Anthropic.MessageParam[] = []
    let total = 0
    for (const t of turns) {
      const r = await runAgent({
        instruction: t.text, source: SOURCE, practice: true, fromAPerson: true,
        notes: 'index', catalog: catalogIndexOn() ? 'index' : 'full',
        chatThreadId: `replay_live_tail_${layout}`, history: [...history],
        liveTail: layout === 'tail',
      })
      history.push({ role: 'user', content: t.text }, { role: 'assistant', content: r.text || '(no reply)' })
      const reqs = r.usage.requests ?? []
      const cost = reqs.reduce((n, q) => n + (costOf(q) ?? 0), 0)
      total += cost
      const calls = r.toolCalls as Call[]
      const ctx = (r.usage as { context?: { blocks?: { tail?: boolean } } }).context
      done.push({
        layout, kind: t.kind, stopReason: r.usage.stopReason, reply: r.text,
        tailApplied: ctx?.blocks?.tail === true,
        writesRun: calls.filter((c) => c.status === 'succeeded' && c.isWrite && c.result?.skipped !== 'practice').map((c) => c.name ?? '?'),
      })
      const pair = replies.get(t.kind) ?? { off: '', tail: '' }
      pair[layout] = r.text
      replies.set(t.kind, pair)
      console.log(`\n-- ${t.kind}: "${t.text}"  (${reqs.length} requests, ${usd(cost)})`)
      for (const q of reqs) console.log(`   ${reqLine(q)}`)
      for (const c of calls) console.log(`   tool ${c.name} · ${c.status}${c.result?.skipped === 'practice' ? ` · stopped, would have: ${JSON.stringify(c.result.wouldHave?.input).slice(0, 160)}` : ''}`)
    }
    console.log(`\nPractice, tail ${layout}: ${usd(total)}`)
  }
  console.log('\n=== Replies side by side (for a person to compare) ===')
  for (const [kind, p] of replies) {
    console.log(`\n-- ${kind}\n   off:  ${p.off.replace(/\s+/g, ' ').slice(0, 500)}\n   tail: ${p.tail.replace(/\s+/g, ' ').slice(0, 500)}`)
  }
  return checkPractice(done, turns.map((t) => t.kind))
}

async function wire(): Promise<Claim[]> {
  const client = new Anthropic({ maxRetries: 2 })
  const allowed = toolsFor(undefined, 'replay_live_tail')
  const tools = TOOL_DEFS.filter((t) => allowed.includes(t.name))
  const catalog = catalogIndexOn() ? 'index' as const : 'full' as const
  // A line naming this run opens each live block, so no earlier run's cache
  // can make a write look smaller than it is. Tools, rules and stable are
  // left as chat sends them.
  const mark = `Replay run ${new Date().toISOString()}.\n`
  const on = await buildCatalogParts({ notes: 'index', catalog, tail: true })
  const off = await buildCatalogParts({ notes: 'index', catalog, tail: false })
  if (!on.tail) throw new Error('no tail sections in the catalogue: nothing to measure')
  const add = (text: string, line: string) => text.replace(/\n*$/, `\n- (replay) ${line}\n`)
  const tailOn = { ...on, live: mark + on.live }
  const tailEdit = { ...tailOn, tail: add(on.tail, 'a synthetic to-do line') }
  const headEdit = { ...tailOn, live: add(tailOn.live, 'a synthetic head line') }
  // The tail-off live block ends with the catalogue's last section (customer
  // support, a tail section), so the same line at its end is the same change.
  const tailOff = { ...off, live: mark + off.live }
  const offTailEdit = { ...tailOff, live: add(tailOff.live, 'a synthetic to-do line') }

  // Token counts are free; measured as the difference one block makes.
  const count = async (texts: string[]) => (await client.messages.countTokens({
    model: CHAT_MODEL, system: texts.map((text) => ({ type: 'text' as const, text })), messages: [{ role: 'user', content: 'x' }],
  })).input_tokens
  const base = await count(['.'])
  const tokensOf = async (text: string) => (await count(['.', text])) - base
  const tokens = { head: await tokensOf(tailOn.live), tail: await tokensOf(on.tail), live: await tokensOf(tailOff.live) }

  const send = async (label: string, catalogue: { stable: string; live: string; tail?: string }): Promise<Measured> => {
    const startedAt = Date.now()
    const res = await client.messages.create({
      model: CHAT_MODEL, max_tokens: 32, tools,
      system: systemBlocks({ rules: SYSTEM_RULES, catalog: catalogue }),
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    })
    const q = usageOf(CHAT_MODEL, res.usage, startedAt)
    await recordUsage(SOURCE, [q])
    console.log(`${label.padEnd(28)} ${reqLine(q)}`)
    return { read: q.cacheReadTokens, write: q.cacheWriteTokens, cost: costOf(q) ?? 0 }
  }
  console.log('\n=== Wire replay (in-memory edits) ===')
  console.log(`measured tokens: head ${tokens.head} · tail ${tokens.tail} · tail-off live block ${tokens.live}`)
  const run: WireRun = {
    warm: await send('tail on, warm', tailOn),
    same: await send('tail on, identical again', tailOn),
    tailEdit: await send('tail-only edit', tailEdit),
    headEdit: await send('head edit', headEdit),
    offWarm: await send('control: tail off, warm', tailOff),
    offTailEdit: await send('control: tail off, edit', offTailEdit),
    tokens,
  }
  return checkWire(run)
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set: this replay calls the API. Nothing was run.')
  const which = process.argv[2] ?? 'both'
  if (!['practice', 'wire', 'both'].includes(which)) throw new Error(`unknown part "${which}": practice, wire or both`)
  const claims: Claim[] = []
  if (which === 'practice' || which === 'both') claims.push(...await practice())
  if (which === 'wire' || which === 'both') claims.push(...await wire())
  console.log('\n=== Claims ===')
  for (const c of claims) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.claim}\n      ${c.detail}`)
  const failed = claims.filter((c) => !c.ok).length
  console.log(`\n${claims.length - failed} of ${claims.length} claims held.`)
  return failed
}

main().then((failed) => process.exit(failed ? 1 : 0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(2) })
