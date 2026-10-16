/**
 * Paid bake-off: the transient-state layout against the live-tail layout
 * production runs, on the same 13 representative practice turns, with real
 * model answers (16 Oct 2026, review build; revised after Codex's review the
 * same day). The claims and their rules are in
 * scripts/transient-bakeoff-checks.ts, tested in tests/transient-bakeoff.test.ts.
 *
 *   npx tsx scripts/transient-smoke.ts <outDir>       first: the real-API layout check (about $0.20)
 *   npx tsx scripts/transient-bakeoff.ts <outDir>     then: the bake-off (roughly $8–12)
 *   (the person's verdicts, given on a review page, are copied into <outDir>/review.json)
 *   npx tsx scripts/transient-bakeoff.ts --accept <outDir>   judges again, spends nothing
 *
 * SPENDS REAL MONEY and needs ANTHROPIC_API_KEY; refuses without it, and
 * refuses unless <outDir>/smoke.json records a passed smoke check.
 *
 * Changes nothing in the business records and no chat thread: every turn is
 * a practice turn (every tool that would change something is stopped before
 * it runs; look-ups read), EMAIL_DRY_RUN is forced on, nothing is saved to a
 * thread. Usage IS recorded, under the source "transient-bakeoff".
 *
 * Fairness:
 * - Same model (CHAT_MODEL), effort, rules, practice rules, catalogue index
 *   mode and turns. The read lane is used in neither. The live-tail side's
 *   tool list is production's, byte for byte; the transient side adds only
 *   list_records.
 * - Interleaved turn by turn, alternating which layout goes first.
 * - One request per layout first warms that layout's tools and standing
 *   rules; reported and left out of the comparison.
 * - Record churn at production's proportion (churnSchedule: 4 head changes
 *   and 1 tail-only in 13 turns, from 11 and 3 in 36 replies). A practice
 *   turn changes no records, so on those turns one line is added where a
 *   real change would land (the live head or tail; the state). Every request
 *   is real and paid; only the trigger for the change is scheduled.
 * - Turns run back to back. In production 43% of messages come more than five
 *   minutes after the last, which costs the live-tail layout a full rewrite
 *   of its five-minute blocks and the transient one nothing extra: this is
 *   conservative for the transient layout.
 *
 * Measured per request: tokens in, cache reads and writes (1-hour and
 * 5-minute), output, cost, request number, tool rounds, look-ups so far, the
 * state's characters, and the state's tokens counted on their own by the
 * token-count endpoint. Per tool call: its result's size in characters.
 * Output: every pair side by side, the claims, <outDir>/bakeoff.json, and
 * <outDir>/review.json for the person's verdicts.
 */
// This container sets ANTHROPIC_BASE_URL for its own use; the SDK would send
// these requests there. Pinned to Anthropic's public API, unless a dry run
// points MOUSE_API_BASE_URL at a local fake.
process.env.ANTHROPIC_BASE_URL = process.env.MOUSE_API_BASE_URL ?? 'https://api.anthropic.com'
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
import { existsSync, readFileSync } from 'node:fs'
import { allClaims, churnSchedule, totals, type Call, type Claim, type Layout, type Review, type TurnRun } from './transient-bakeoff-checks'

// A plumbing check against a local fake API (BAKEOFF_DRY_RUN=1) records under its own name.
const SOURCE = process.env.BAKEOFF_DRY_RUN === '1' ? 'transient-bakeoff-dryrun' : 'transient-bakeoff'
const usd = (n: number) => `$${n.toFixed(4)}`

type Turn = {
  kind: string; text: string; paused?: boolean
  /** null only for the turn left wholly to the person; a required check whose record is missing names it in `missing`. */
  check: ((r: { text: string; calls: Call[] }) => { ok: boolean; detail: string }) | null
  missing?: string
}

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
      missing: po ? undefined : 'no sent PO with catalogue lines',
      check: po ? (r) => {
        const got = r.calls.filter((x) => x.skippedPractice && x.name === 'log_inventory_event' && (x.input as { type?: string; purchaseOrderNumber?: string }).type === 'RECEIVED')
        const asked = /\?/.test(r.text)
        const ok = got.length > 0 || asked
        return { ok, detail: got.length ? `would have received ${got.length} line(s) against PO ${(got[0].input as { purchaseOrderNumber?: string }).purchaseOrderNumber ?? '(no PO number given)'}` : asked ? 'asked before receiving' : 'neither received nor asked' }
      } : null,
    },
    { kind: 'finance: cash', text: 'What does the app have for cash in the bank, and should I be worried that it is old?', check: finance ? has(new RegExp(finance.forDate.toISOString().slice(0, 10) + '|' + new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(finance.forDate)), 'the date the figure is as of') : null, missing: finance ? undefined : 'no financial snapshot on file' },
    {
      kind: 'finance: friends and family', text: 'A friend wants the Bean Bag at the friends and family price. What would she pay?',
      check: (r) => {
        const bad = ffWrong.find((v) => r.text.includes(v) || r.text.includes(v.replace(/\.00$/, '')))
        return { ok: !bad, detail: bad ? `worked the price out itself ($${bad})` : 'did not do the discount sum itself' }
      },
    },
    { kind: 'never size an order', text: 'How many Cleo Tees should we order in the next run?', check: null },
    { kind: 'files', text: 'What does our W-9 say on line 3a?', check: w9 ? has(/partnership|\bP\b/i, 'partnership (P)') : null, missing: w9 ? undefined : 'no W-9 kept in Files' },
    { kind: 'email lookup', text: 'Did Michael from Calamo say anything about the 3103 white silk?', check: calamoMail ? has(/12\.75|ivory/i, 'what Michael said (12.75 yards, more ivory)') : null, missing: calamoMail ? undefined : 'no Calamo email about 3103 on file' },
    { kind: 'product notes', text: 'What lining does the Story Dress use?', check: has(/tibetan cotton/i, 'Tibetan cotton') },
    { kind: 'to-do awareness', text: 'Is there already a to-do about reordering shipping tape? If not, add one.', check: tapeTodo ? has(/already|existing|there is|there's|open/i, 'that one exists') : null, missing: tapeTodo ? undefined : 'no open to-do about tape' },
    {
      kind: 'multi-round', text: 'Which open purchase orders are past their due date, and what is still owed on each?',
      check: overdue.length ? (r) => { const hit = overdue.find((p) => r.text.includes(String(p.poNumber))); return { ok: !!hit, detail: hit ? `names overdue PO ${hit.poNumber}` : `names none of ${overdue.map((p) => p.poNumber).join(', ')}` } } : null,
      missing: overdue.length ? undefined : 'no overdue open PO to ask about',
    },
  ]
}

type Raw = { name?: string; status?: string; isWrite?: boolean; input?: unknown; result?: { skipped?: string }; resultChars?: number }
const asCalls = (calls: unknown[]): Call[] => (calls as Raw[]).map((c) => ({ name: String(c.name), status: String(c.status), isWrite: c.isWrite, skippedPractice: c.result?.skipped === 'practice', input: c.input, resultChars: c.resultChars ?? 0 }))

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

function printClaims(claims: Claim[]) {
  console.log('\n=== Claims ===')
  for (const c of claims) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.claim}\n      ${c.detail}`)
  const failed = claims.filter((c) => !c.ok).length
  console.log(`\n${claims.length - failed} of ${claims.length} claims held.`)
  return failed
}

/** --accept <outDir>: judge a saved run again, with the person's review.json. Spends nothing. */
function accept(outDir: string): number {
  const run = JSON.parse(readFileSync(join(outDir, 'bakeoff.json'), 'utf8')) as { turns: TurnRun[]; production: { perReply: number; replies: number } }
  const reviewFile = join(outDir, 'review.json')
  const review = existsSync(reviewFile) ? (JSON.parse(readFileSync(reviewFile, 'utf8')) as { verdicts: Review }).verdicts : null
  return printClaims(allClaims(run.turns, { productionPerReply: run.production.perReply, productionReplies: run.production.replies, review }))
}

async function main() {
  if (process.argv[2] === '--accept') {
    if (!process.argv[3]) throw new Error('--accept needs the bake-off folder')
    return accept(process.argv[3])
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set: this bake-off calls the API. Nothing was run.')
  const outDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'transient-bakeoff-'))
  mkdirSync(outDir, { recursive: true })
  if (process.env.BAKEOFF_DRY_RUN !== '1') {
    const smoke = join(outDir, 'smoke.json')
    if (!existsSync(smoke) || (JSON.parse(readFileSync(smoke, 'utf8')) as { ok?: boolean }).ok !== true) {
      throw new Error(`No passed smoke check in ${smoke}: run scripts/transient-smoke.ts ${outDir} first. Nothing was run.`)
    }
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const list = await turns()
  const churn = churnSchedule(list.length)
  const prod = await productionBaseline()

  // Warm each layout's own tools and the standing rules (the tool lists differ by list_records).
  const client = new Anthropic({ maxRetries: 2 })
  const primers: Record<string, unknown> = {}
  for (const layout of ['live-tail', 'transient'] as const) {
    const tools = TOOL_DEFS.filter((t) => toolsFor(undefined, 'bakeoff', undefined, { transient: layout === 'transient' }).includes(t.name))
    const startedAt = Date.now()
    const primer = await client.messages.create({ model: CHAT_MODEL, max_tokens: 16, tools, system: [{ type: 'text', text: SYSTEM_RULES, cache_control: { type: 'ephemeral', ttl: '1h' } }], messages: [{ role: 'user', content: 'Reply OK.' }] })
    const pq = usageOf(CHAT_MODEL, primer.usage, startedAt)
    await recordUsage(SOURCE, [pq])
    primers[layout] = pq
    console.log(`primer ${layout} (its tools and the rules, not compared): write ${pq.cacheWriteTokens} · read ${pq.cacheReadTokens} · ${usd(costOf(pq) ?? 0)}`)
  }

  const history: Record<Layout, Anthropic.MessageParam[]> = { 'live-tail': [], transient: [] }
  const runs: TurnRun[] = []
  const wasWrites = process.env.INVENTORY_WRITES
  for (const [k, t] of list.entries()) {
    const change = churn[k] ? { at: churn[k], line: `turn ${k + 1} record change, run ${runId}` } : undefined
    const order: Layout[] = k % 2 === 0 ? ['live-tail', 'transient'] : ['transient', 'live-tail']
    // Practice stops every write either way; this only sets what the layouts are told.
    process.env.INVENTORY_WRITES = t.paused ? 'off' : 'on'
    for (const layout of order) {
      const r = await runAgent({
        instruction: t.text, source: SOURCE, practice: true, fromAPerson: true,
        notes: 'index', catalog: 'index', chatThreadId: `bakeoff_${layout}_${runId}`, history: [...history[layout]],
        ...(layout === 'live-tail'
          ? { liveTail: true, prefetch: await prefetchForMessage(t.text, { catalogue: true }) }
          : { transient: { message: t.text, access: { actorName: 'Brandon', inventoryWrites: !t.paused, shopifyWrites: !t.paused } }, countStateTokens: true }),
        replayChange: change,
      })
      history[layout].push({ role: 'user', content: t.text }, { role: 'assistant', content: r.text || '(no reply)' })
      const calls = asCalls(r.toolCalls)
      const requests = (r.usage.requests ?? []) as TurnRun['requests']
      const cost = requests.reduce((n, q) => n + (costOf(q as RequestUsage) ?? 0), 0)
      runs.push({
        layout, kind: t.kind, text: r.text, stopReason: r.usage.stopReason, calls, requests, cost,
        check: t.check ? t.check({ text: r.text, calls }) : null,
        ...(t.missing ? { fixtureMissing: t.missing } : {}),
        ...(r.usage.core ? { coreHash: r.usage.core.hash } : {}),
      })
    }
    const pair = runs.slice(-2)
    console.log(`\n-- turn ${k + 1}: ${t.kind}${change ? ` (record change: ${change.at})` : ''}${t.paused ? ' (stock writing paused)' : ''}\n   "${t.text}"`)
    for (const x of pair) {
      console.log(`   ${x.layout.padEnd(9)} ${usd(x.cost)} · ${x.requests.length} req · ${x.stopReason}${x.fixtureMissing ? ` · FIXTURE MISSING: ${x.fixtureMissing}` : x.check ? ` · check ${x.check.ok ? 'PASS' : 'FAIL'}: ${x.check.detail}` : ' · for the person to judge'}`)
      for (const q of x.requests) console.log(`      #${q.requestNumber} rounds ${q.toolRounds} look-ups ${q.fullRecordFetches} · in ${q.inputTokens} read ${q.cacheReadTokens} write ${q.cacheWriteTokens} (1h ${q.cacheWrite1hTokens}) out ${q.outputTokens}${q.transientChars !== undefined ? ` · state ${q.transientTokens ?? 'NOT COUNTED'} tok (counted) / ${q.transientChars} ch` : ''} · ${usd(costOf(q as RequestUsage) ?? 0)}`)
      for (const c of x.calls) console.log(`      tool ${c.name} · ${c.status} · result ${c.resultChars} ch${c.skippedPractice ? ` · stopped, would have: ${JSON.stringify(c.input).slice(0, 140)}` : ''}`)
      console.log(`      reply: ${x.text.replace(/\s+/g, ' ').slice(0, 400)}`)
    }
  }
  if (wasWrites === undefined) delete process.env.INVENTORY_WRITES
  else process.env.INVENTORY_WRITES = wasWrites

  const a = totals(runs, 'live-tail'), b = totals(runs, 'transient')
  console.log('\n=== Totals (primers excluded) ===')
  for (const [l, x] of [['live-tail', a], ['transient', b]] as const) {
    console.log(`${l.padEnd(9)} ${x.turns} turns · ${x.requests} requests · ${usd(x.cost)} ($${(x.cost / x.turns).toFixed(3)}/turn) · write ${x.write} (1h ${x.write1h}) · read ${x.read} · uncached in ${x.input} · out ${x.output} · look-ups ${x.fetches} · tool results ${x.toolResultChars} ch (largest ${x.largestToolResult}) · tool rounds ${x.toolRounds}`)
  }
  // The person's sheet: every pair, a verdict each.
  const kinds = [...new Set(runs.map((r) => r.kind))]
  writeFileSync(join(outDir, 'review.json'), JSON.stringify({
    instructions: 'For each pair, read both replies (bakeoff.json, or the printout) and set verdict to "ok" if the transient reply is as good or better, "worse" if not, with notes. Then: npx tsx scripts/transient-bakeoff.ts --accept <this folder>',
    pairs: Object.fromEntries(kinds.map((k) => [k, { question: list.find((t) => t.kind === k)?.text, liveTail: runs.find((r) => r.kind === k && r.layout === 'live-tail')?.text, transient: runs.find((r) => r.kind === k && r.layout === 'transient')?.text }])),
    verdicts: Object.fromEntries(kinds.map((k) => [k, { verdict: null, notes: '' }])),
  }, null, 2))
  writeFileSync(join(outDir, 'bakeoff.json'), JSON.stringify({ runId, production: prod, primers, churn, turns: runs, totals: { 'live-tail': a, transient: b } }, null, 2))
  console.log(`\nWhole run: ${join(outDir, 'bakeoff.json')}. The person's sheet: ${join(outDir, 'review.json')}.`)
  const failed = printClaims(allClaims(runs, { productionPerReply: prod.perReply, productionReplies: prod.replies, review: null }))
  await db.$disconnect()
  return failed
}

main().then((f) => process.exit(f ? 1 : 0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(2) })
