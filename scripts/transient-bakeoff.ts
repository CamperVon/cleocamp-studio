/**
 * Paid bake-off: the transient-state layout against the live-tail layout
 * production runs, on the same representative turns, with real model
 * answers (16 Oct 2026, review build). Exits nonzero if any claim fails;
 * the claims and targets are in scripts/transient-bakeoff-checks.ts, tested
 * in tests/transient-bakeoff.test.ts.
 *
 *   npx tsx scripts/transient-bakeoff.ts [outDir]
 *
 * SPENDS REAL MONEY on the Anthropic API (roughly $8–12: about 13 turns in
 * each layout on Opus, plus one small request to warm the shared rules) and
 * needs ANTHROPIC_API_KEY; it refuses to start without it.
 *
 * What it changes: nothing in the business records and no chat thread.
 * Every turn is a practice turn (every tool that would change something is
 * stopped before it runs and hands back what it would have done; look-ups
 * read), EMAIL_DRY_RUN is forced on, and nothing is saved to a thread. Usage
 * IS recorded: every paid request writes a ModelUsage row with source
 * "transient-bakeoff", so the spend is visible and never mistaken for chat.
 *
 * Fairness, stated so it can be argued with:
 * - Same model (CHAT_MODEL), effort, tools, rules, practice rules, catalogue
 *   index mode and turns in both. The read lane is not used in either.
 * - The two conversations run interleaved, turn by turn, alternating which
 *   layout goes first, so both see the same API and the same clock.
 * - One request first warms the cache of what both share (tools and the
 *   standing rules); it is reported and left out of the comparison.
 * - Record churn. A practice turn changes nothing, so without help the
 *   live-tail catalogue would never change between turns and would read as
 *   cheaper than it is. On the turns listed in CHURN, one line is added
 *   where a real change would land (the live head or the live tail; the
 *   state in the transient layout), matched to production: in the 24 hours
 *   to 16 Oct, of 36 chat replies compared, 11 changed the live head and 3
 *   only the tail. Every request is real and paid; only the trigger for the
 *   change is scheduled.
 * - Turns run back to back, well inside five minutes. In production 43% of
 *   messages come more than five minutes after the last, which costs the
 *   live-tail layout a full rewrite of its five-minute blocks and the
 *   transient one nothing extra (its history mark lasts an hour), so this is
 *   conservative for the transient layout.
 * - The stable core and the live-tail catalogue are written once each at
 *   the start, as in a cold production session.
 *
 * Output: every reply side by side for a person to judge, every request's
 * tokens and cost, the state's measured size per request, the claims, and
 * the whole run as JSON in outDir for review.
 */
process.env.EMAIL_DRY_RUN = '1'
import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { runAgent, toolsFor, CHAT_MODEL } from '@/lib/mouse/agent'
import { prefetchForMessage } from '@/lib/mouse/records'
import { runsOf, type SavedUsage } from '@/lib/mouse/cache-diagnostics'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { TOOL_DEFS } from '@/lib/mouse/tools'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import type { RequestUsage } from '@/lib/mouse/runner'
import { costOf } from './cost-quality-audit'
import { checkProjection, checkQuality, checkSafety, checkSize, checkWrites, totals, type Call, type Claim, type Layout, type TurnRun } from './transient-bakeoff-checks'

// A plumbing check against a local fake API (BAKEOFF_DRY_RUN=1) records under its own name.
const SOURCE = process.env.BAKEOFF_DRY_RUN === '1' ? 'transient-bakeoff-dryrun' : 'transient-bakeoff'
const usd = (n: number) => `$${n.toFixed(4)}`

type Turn = {
  kind: string; text: string; heavy?: boolean; paused?: boolean
  check: ((r: { text: string; calls: Call[] }) => { ok: boolean; detail: string }) | null
}

/** Which turns get a scheduled record change, and where (see the header). */
export const CHURN: Record<number, 'head' | 'tail'> = { 2: 'head', 4: 'head', 5: 'tail', 7: 'head', 9: 'head', 11: 'tail', 12: 'head' }

const has = (re: RegExp, what: string) => (r: { text: string }) => ({ ok: re.test(r.text), detail: re.test(r.text) ? `says ${what}` : `does not say ${what}: "${r.text.replace(/\s+/g, ' ').slice(0, 160)}"` })

async function turns(): Promise<Turn[]> {
  // Real records, so the turns read like the team's: picked, never changed.
  const variant = await db.productVariant.findFirst({
    where: { size: { not: null }, onHandQty: { gt: 3 }, colorwayId: { not: null }, product: { status: 'ACTIVE' } },
    orderBy: [{ onHandQty: 'desc' }, { id: 'asc' }],
    select: { id: true, size: true, onHandQty: true, colorway: { select: { customerName: true } }, product: { select: { name: true } } },
  })
  if (!variant) throw new Error('no counted variant to ask about')
  const label = `${variant.product.name} in ${variant.colorway!.customerName}, size ${variant.size}`
  const count = Number(variant.onHandQty)
  const po = await db.purchaseOrder.findFirst({
    where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] }, lines: { some: { OR: [{ componentId: { not: null } }, { productVariantId: { not: null } }] } } },
    orderBy: [{ poNumber: 'asc' }, { id: 'asc' }], select: { poNumber: true },
  })
  const today = new Date()
  const laDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(today)
  const monthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' }).format(today)
  const [m, d] = monthDay.split(' ')
  const dateRe = new RegExp(`${laDay}|${m}\\s+${d}\\b|\\b${d}\\s+${m}|${m.slice(0, 3)}\\.?\\s+${d}\\b`, 'i')
  const finance = await db.financialSnapshot.findFirst({ orderBy: { forDate: 'desc' }, select: { forDate: true } })
  const w9 = await db.storedFile.findFirst({ where: { title: { contains: 'W-9' } }, select: { title: true } })
  const calamoMail = await db.inboundEmail.count({ where: { fromAddress: { contains: 'calamosilk' }, text: { contains: '3103' } } })
  const overdue = await db.purchaseOrder.findMany({ where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] }, expectedAt: { lt: new Date(`${laDay}T00:00:00-07:00`) } }, select: { poNumber: true } })
  const tapeTodo = await db.actionItem.count({ where: { resolved: false, title: { contains: 'tape', mode: 'insensitive' } } })
  const bean = await db.product.findFirst({ where: { name: 'Bean Bag' }, select: { retailPriceCents: true } })
  const ffWrong = [39800, 36800, bean?.retailPriceCents ?? 0].filter(Boolean).map((c) => (c * 0.8 / 100).toFixed(2))

  return [
    { kind: 'time zone', text: `What's today's date and time here in LA, and is PO ${po?.poNumber ?? 'the oldest open order'} due before next Friday?`, check: has(dateRe, `today's Los Angeles date (${laDay})`) },
    { kind: 'stock count', text: `How many ${label} do we have right now?`, check: has(new RegExp(`\\b${count}\\b`), `the count on file (${count})`) },
    {
      kind: 'stock write', text: `We just counted 6 of the ${label} in the studio. Log that.`,
      check: (r) => {
        const c = r.calls.find((x) => x.name === 'log_inventory_event' && x.skippedPractice)
        const i = (c?.input ?? {}) as { productVariantId?: string; countedQty?: number; type?: string }
        const ok = !!c && i.productVariantId === variant.id && (i.countedQty === 6 || i.type === 'COUNTED')
        return { ok, detail: ok ? 'would have logged a count of 6 on the right variant' : `would-have call: ${JSON.stringify(c?.input ?? null).slice(0, 200)}` }
      },
    },
    { kind: 'stock pause', paused: true, text: `Take 2 of the ${label} off stock, they went to a stylist today.`, check: has(/pause|not (?:be |been )?applied|to-?do|would (?:have )?(?:record|log|note)/i, 'that stock writing is paused (noted, not applied)') },
    {
      kind: 'PO receipt', text: `PO ${po?.poNumber ?? '?'} arrived in full today.`,
      check: po ? (r) => {
        const got = r.calls.filter((x) => x.skippedPractice && x.name === 'log_inventory_event' && (x.input as { type?: string; purchaseOrderNumber?: string }).type === 'RECEIVED')
        const asked = /\?/.test(r.text)
        const ok = got.length > 0 || asked
        return { ok, detail: got.length ? `would have received ${got.length} line(s) against PO ${(got[0].input as { purchaseOrderNumber?: string }).purchaseOrderNumber ?? '(no PO number given)'}` : asked ? 'asked before receiving' : 'neither received nor asked' }
      } : null,
    },
    { kind: 'finance: cash', text: 'What does the app have for cash in the bank, and should I be worried that it is old?', check: finance ? has(new RegExp(finance.forDate.toISOString().slice(0, 10) + '|' + new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(finance.forDate)), 'the date the figure is as of') : null },
    {
      kind: 'finance: friends and family', text: 'A friend wants the Bean Bag at the friends and family price. What would she pay?',
      check: (r) => {
        const bad = ffWrong.find((v) => r.text.includes(v) || r.text.includes(v.replace(/\.00$/, '')))
        return { ok: !bad, detail: bad ? `worked the price out itself ($${bad})` : 'did not do the discount sum itself' }
      },
    },
    { kind: 'never size an order', text: 'How many Cleo Tees should we order in the next run?', check: null },
    { kind: 'files', heavy: true, text: 'What does our W-9 say on line 3a?', check: w9 ? has(/partnership|\bP\b/i, 'partnership (P)') : null },
    { kind: 'email lookup', heavy: true, text: 'Did Michael from Calamo say anything about the 3103 white silk?', check: calamoMail ? has(/12\.75|ivory/i, 'what Michael said (12.75 yards, more ivory)') : null },
    { kind: 'product notes', text: 'What lining does the Story Dress use?', check: has(/tibetan cotton/i, 'Tibetan cotton') },
    { kind: 'to-do awareness', text: 'Is there already a to-do about reordering shipping tape? If not, add one.', check: tapeTodo ? has(/already|existing|there is|there's|open/i, 'that one exists') : null },
    {
      kind: 'multi-round', heavy: true, text: 'Which open purchase orders are past their due date, and what is still owed on each?',
      check: overdue.length ? (r) => { const hit = overdue.find((p) => r.text.includes(String(p.poNumber))); return { ok: !!hit, detail: hit ? `names overdue PO ${hit.poNumber}` : `names none of ${overdue.map((p) => p.poNumber).join(', ')}` } } : null,
    },
  ]
}

type Raw = { name?: string; status?: string; isWrite?: boolean; input?: unknown; result?: { skipped?: string } }
const asCalls = (calls: unknown[]): Call[] => (calls as Raw[]).map((c) => ({ name: String(c.name), status: String(c.status), isWrite: c.isWrite, skippedPractice: c.result?.skipped === 'practice', input: c.input }))

/** Production's own cost per completed chat reply since the live tail went on (13 Oct 2026). */
async function productionBaseline(): Promise<{ perReply: number; replies: number }> {
  const rows = await db.chatMessage.findMany({ where: { role: 'ASSISTANT', createdAt: { gte: new Date('2026-10-13T07:00:00Z') } }, select: { agentUsageJson: true } })
  let n = 0, total = 0
  for (const r of rows) {
    const u = r.agentUsageJson as (SavedUsage & { stopReason?: string }) | null
    if (!u || u.stopReason !== 'complete') continue
    const runs = runsOf(u)
    if (!runs.length) continue
    n++
    total += runs.flatMap((x) => (x.requests ?? []) as RequestUsage[]).reduce((s, q) => s + (costOf(q) ?? 0), 0)
  }
  return { perReply: n ? total / n : NaN, replies: n }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set: this bake-off calls the API. Nothing was run.')
  const outDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'transient-bakeoff-'))
  mkdirSync(outDir, { recursive: true })
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const list = await turns()
  const prod = await productionBaseline()

  // Warm what both layouts share: the tools and the standing rules.
  const client = new Anthropic({ maxRetries: 2 })
  const tools = TOOL_DEFS.filter((t) => toolsFor(undefined, 'bakeoff').includes(t.name))
  const startedAt = Date.now()
  const primer = await client.messages.create({ model: CHAT_MODEL, max_tokens: 16, tools, system: [{ type: 'text', text: SYSTEM_RULES, cache_control: { type: 'ephemeral', ttl: '1h' } }], messages: [{ role: 'user', content: 'Reply OK.' }] })
  const pq = usageOf(CHAT_MODEL, primer.usage, startedAt)
  await recordUsage(SOURCE, [pq])
  console.log(`primer (shared tools and rules, not compared): write ${pq.cacheWriteTokens} · read ${pq.cacheReadTokens} · ${usd(costOf(pq) ?? 0)}`)

  const history: Record<Layout, Anthropic.MessageParam[]> = { 'live-tail': [], transient: [] }
  const runs: TurnRun[] = []
  const wasWrites = process.env.INVENTORY_WRITES
  for (const [k, t] of list.entries()) {
    const change = CHURN[k] ? { at: CHURN[k], line: `turn ${k} record change, run ${runId}` } : undefined
    const order: Layout[] = k % 2 === 0 ? ['live-tail', 'transient'] : ['transient', 'live-tail']
    // Practice stops every write either way; this only sets what the layouts are told.
    process.env.INVENTORY_WRITES = t.paused ? 'off' : 'on'
    for (const layout of order) {
      const r = await runAgent({
        instruction: t.text, source: SOURCE, practice: true, fromAPerson: true,
        notes: 'index', catalog: 'index', chatThreadId: `bakeoff_${layout}_${runId}`, history: [...history[layout]],
        ...(layout === 'live-tail'
          ? { liveTail: true, prefetch: await prefetchForMessage(t.text, { catalogue: true }) }
          : { transient: { message: t.text, access: { actorName: 'Brandon', inventoryWrites: !t.paused, shopifyWrites: !t.paused } } }),
        replayChange: change,
      })
      history[layout].push({ role: 'user', content: t.text }, { role: 'assistant', content: r.text || '(no reply)' })
      const calls = asCalls(r.toolCalls)
      const requests = (r.usage.requests ?? []) as TurnRun['requests']
      const cost = requests.reduce((n, q) => n + (costOf(q as RequestUsage) ?? 0), 0)
      runs.push({ layout, kind: t.kind, heavy: t.heavy === true, text: r.text, stopReason: r.usage.stopReason, calls, requests, cost, check: t.check ? t.check({ text: r.text, calls }) : null })
    }
    const pair = runs.slice(-2)
    console.log(`\n-- turn ${k + 1}: ${t.kind}${change ? ` (record change: ${change.at})` : ''}${t.paused ? ' (stock writing paused)' : ''}\n   "${t.text}"`)
    for (const x of pair) {
      console.log(`   ${x.layout.padEnd(9)} ${usd(x.cost)} · ${x.requests.length} req · ${x.stopReason}${x.check ? ` · check ${x.check.ok ? 'PASS' : 'FAIL'}: ${x.check.detail}` : ' · for a person to judge'}`)
      for (const q of x.requests) console.log(`      #${q.requestNumber} rounds ${q.toolRounds} fetches ${q.fullRecordFetches} · in ${q.inputTokens} read ${q.cacheReadTokens} write ${q.cacheWriteTokens} (1h ${q.cacheWrite1hTokens}) out ${q.outputTokens}${q.transientTokens !== undefined ? ` · state ${q.transientTokens} tok / ${q.transientChars} ch` : ''} · ${usd(costOf(q as RequestUsage) ?? 0)}`)
      for (const c of x.calls) console.log(`      tool ${c.name} · ${c.status}${c.skippedPractice ? ` · stopped, would have: ${JSON.stringify(c.input).slice(0, 140)}` : ''}`)
      console.log(`      reply: ${x.text.replace(/\s+/g, ' ').slice(0, 400)}`)
    }
  }
  if (wasWrites === undefined) delete process.env.INVENTORY_WRITES
  else process.env.INVENTORY_WRITES = wasWrites

  const claims: Claim[] = [checkSafety(runs), ...checkQuality(runs), checkSize(runs), checkWrites(runs), checkProjection(runs, prod.perReply, prod.replies)]
  const a = totals(runs, 'live-tail'), b = totals(runs, 'transient')
  console.log('\n=== Totals (primer excluded) ===')
  for (const [l, x] of [['live-tail', a], ['transient', b]] as const) {
    console.log(`${l.padEnd(9)} ${x.turns} turns · ${x.requests} requests · ${usd(x.cost)} ($${(x.cost / x.turns).toFixed(3)}/turn) · write ${x.write} (1h ${x.write1h}) · read ${x.read} · uncached in ${x.input} · out ${x.output} · look-ups ${x.fetches} · tool rounds ${x.toolRounds}`)
  }
  console.log('\n=== Claims ===')
  for (const c of claims) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.claim}\n      ${c.detail}`)
  writeFileSync(join(outDir, 'bakeoff.json'), JSON.stringify({ runId, production: prod, primer: pq, churn: CHURN, turns: runs, totals: { 'live-tail': a, transient: b }, claims }, null, 2))
  console.log(`\nWhole run: ${join(outDir, 'bakeoff.json')}`)
  const failed = claims.filter((c) => !c.ok).length
  console.log(`${claims.length - failed} of ${claims.length} claims held.`)
  await db.$disconnect()
  return failed
}

main().then((f) => process.exit(f ? 1 : 0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(2) })
