import Anthropic from '@anthropic-ai/sdk'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { catalogIndexOn, liveTailOn } from '@/lib/mouse/context'
import { costOf } from '@/lib/mouse/prices'
import { transientStateOn } from '@/lib/mouse/transient'
import { inventoryWritesEnabled } from '@/lib/mouse/tools'
import {
  BAKEOFF_KEY, BAKEOFF_SOURCE, CAP_USD, LATEST_START_MS, LAYOUTS, Ledger, ROUTE_BUDGET_MS, STALE_STEP_MS,
  report, restFits, runCheck, stepFailure, turnsIn, worstCaseUsd,
  type Call, type Layout, type Req, type Scenario, type StepResult, type TurnResult,
} from '@/lib/mouse/shadow-bakeoff-judge'

/**
 * The one-time production shadow bake-off (Codex, 16 Oct 2026): the live-tail
 * layout production runs today against the transient-state layout, on the
 * same representative scenarios, with Mouse's full tools in both and every
 * write stopped. The design, the scenario list and the cost ceiling are in
 * docs/TRANSIENT-SHADOW-BAKEOFF.md; the rules and the report are in
 * lib/mouse/shadow-bakeoff-judge.ts.
 *
 * Trigger: the chat route calls scheduleShadowBakeoff after a completed reply
 * on production; Next's after() runs it once the response has been sent, so
 * the real reply is neither changed nor delayed. Each completed chat runs at
 * most ONE scenario, both layouts at once on the same records, because a set
 * of full Mouse turns cannot fit in one route's 300 s. Progress lives on the
 * ShadowRun row keyed BAKEOFF_KEY, which is also the lock:
 *
 *   (no row) → RUNNING (planning, then scenario 1) → WAITING → RUNNING → … → COMPLETE
 *                                     any failure, at any point  → FAILED, for good
 *
 * Only the caller whose INSERT lands, or whose UPDATE … WHERE status =
 * 'WAITING' lands, runs a step; everyone else does nothing. A step left
 * RUNNING longer than STALE_STEP_MS was cut off, and the next caller marks
 * the bake-off FAILED instead of resuming it. Nothing is ever retried.
 *
 * Writes: every turn is a practice turn (runAgent practice: true): only
 * look-up tools run; any tool that would change something is stopped before
 * it runs and returns what it would have done. No chat thread, email,
 * Shopify, calendar or business record is written. Usage rows are, under
 * BAKEOFF_SOURCE, and the result on the ShadowRun row. A step in which any
 * tool other than a look-up ran fails the bake-off. The process environment
 * is never touched (it is shared with real traffic on the same instance).
 *
 * Money: $10 ceiling (CAP_USD). Before the first request, and before each
 * scenario, the rest of the set must fit at the expected cost or nothing more
 * is spent. Before each request, its prompt is counted (free) and its worst
 * case reserved; a request that would take spent + reserved past the cap is
 * never sent, and the bake-off fails. No retries, no server-side fallback.
 */

export type BakeoffState = {
  phase: 'planning' | 'running' | 'waiting' | 'complete' | 'failed'
  scenarios: Scenario[]
  steps: StepResult[]
  spentUsd: number
  stepStartedAt: string | null
  plannedAt: string
  estimate: string | null
}

export type BakeoffRow = { status: string; resultJson: unknown; startedAt: Date }
export type BakeoffStore = {
  read(): Promise<BakeoffRow | null>
  /** Insert the RUNNING row; true only for the one caller whose insert landed. */
  claimNew(state: BakeoffState, row: { codeVersion: string | null; deploymentId: string | null }): Promise<boolean>
  /** WAITING → RUNNING; true only for the one caller whose update landed. */
  claimNext(state: BakeoffState): Promise<boolean>
  /** RUNNING (a step cut off) → FAILED; true if it was still RUNNING. */
  failStale(state: BakeoffState, error: string): Promise<boolean>
  save(status: 'RUNNING' | 'WAITING' | 'COMPLETE' | 'FAILED', state: BakeoffState, error: string | null, report: unknown): Promise<void>
}

const prismaStore: BakeoffStore = {
  async read() {
    return db.shadowRun.findUnique({ where: { key: BAKEOFF_KEY }, select: { status: true, resultJson: true, startedAt: true } })
  },
  async claimNew(state, row) {
    const r = await db.shadowRun.createMany({ data: [{ key: BAKEOFF_KEY, status: 'RUNNING', resultJson: state as never, ...row }], skipDuplicates: true })
    return r.count === 1
  },
  async claimNext(state) {
    const r = await db.shadowRun.updateMany({ where: { key: BAKEOFF_KEY, status: 'WAITING' }, data: { status: 'RUNNING', resultJson: state as never } })
    return r.count === 1
  },
  async failStale(state, error) {
    const r = await db.shadowRun.updateMany({ where: { key: BAKEOFF_KEY, status: 'RUNNING' }, data: { status: 'FAILED', finishedAt: new Date(), error, resultJson: { ...state, phase: 'failed' } as never } })
    return r.count === 1
  },
  async save(status, state, error, rep) {
    const done = status === 'COMPLETE' || status === 'FAILED'
    await db.shadowRun.update({
      where: { key: BAKEOFF_KEY },
      data: { status, error, resultJson: { ...state, report: rep } as never, ...(done ? { finishedAt: new Date() } : {}) },
    })
  },
}

export type BakeoffEnv = { vercelEnv?: string; commit?: string; deploymentId?: string }
const processEnv = (): BakeoffEnv => ({ vercelEnv: process.env.VERCEL_ENV, commit: process.env.VERCEL_GIT_COMMIT_SHA, deploymentId: process.env.VERCEL_DEPLOYMENT_ID })

/**
 * The scenarios, from current real records: picked, never changed. Codex's
 * list: a look-up, notes / record detail, an inventory update (stopped), a PO
 * receipt (stopped), an email search, and a multi-round task, here carried
 * over two turns so the second measures each layout's next-turn caching.
 * No customer email: Mouse's email tools never read mail to support@
 * (lib/email-lookup.ts), and the email scenario names a vendor.
 */
export async function buildScenarios(): Promise<{ scenarios: Scenario[]; missing: string[] }> {
  const laDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const [variant, po, story, overdue, vendors, mails] = await Promise.all([
    db.productVariant.findFirst({
      where: { size: { not: null }, onHandQty: { gt: 3 }, colorwayId: { not: null }, product: { status: 'ACTIVE' } },
      orderBy: [{ onHandQty: 'desc' }, { id: 'asc' }],
      select: { id: true, size: true, onHandQty: true, colorway: { select: { customerName: true } }, product: { select: { name: true } } },
    }),
    db.purchaseOrder.findFirst({
      where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] }, lines: { some: { OR: [{ componentId: { not: null } }, { productVariantId: { not: null } }] } } },
      orderBy: [{ poNumber: 'asc' }, { id: 'asc' }], select: { poNumber: true },
    }),
    db.product.findFirst({ where: { name: 'Story Dress' }, select: { id: true } }),
    db.purchaseOrder.findMany({ where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] }, expectedAt: { lt: new Date(`${laDay}T00:00:00-07:00`) } }, select: { poNumber: true } }),
    db.vendor.findMany({ where: { active: true, email: { not: null } }, select: { name: true, email: true } }),
    db.inboundEmail.findMany({ where: { NOT: { toAddress: { contains: 'support@' } } }, orderBy: { receivedAt: 'desc' }, take: 200, select: { fromAddress: true, subject: true } }),
  ])
  const missing: string[] = []
  const scenarios: Scenario[] = []
  if (!variant) missing.push('no counted, active variant')
  if (!po) missing.push('no sent PO with catalogue lines')
  if (!overdue.length) missing.push('no overdue open PO')
  const label = variant ? `${variant.product.name} in ${variant.colorway!.customerName}, size ${variant.size}` : ''
  if (variant) {
    scenarios.push({ id: 'lookup', kind: 'look-up', turns: [`How many ${label} do we have right now?`], check: { type: 'mentions', pattern: `\\b${Number(variant.onHandQty)}\\b`, what: `the count on file (${Number(variant.onHandQty)})` }, fixture: `variant ${variant.id}` })
  }
  const storyNote = story ? await db.note.count({ where: { entityType: 'PRODUCT', entityId: story.id, supersededAt: null, content: { contains: 'lining', mode: 'insensitive' } } }) : 0
  scenarios.push(storyNote
    ? { id: 'notes', kind: 'notes / record detail', turns: ['What lining does the Story Dress use?'], check: { type: 'mentions', pattern: 'tibetan cotton', what: 'Tibetan cotton, as its notes say' }, fixture: 'Story Dress notes' }
    : { id: 'notes', kind: 'notes / record detail', turns: ['What do our notes say about the Story Dress?'], check: null, fixture: 'Story Dress notes (no lining note found)' })
  if (variant) {
    scenarios.push({ id: 'inventory', kind: 'inventory update (stopped)', turns: [`We just counted 6 of the ${label} in the studio. Log that.`], check: { type: 'wouldHave', tool: 'log_inventory_event', match: { productVariantId: variant.id }, orAsks: true, what: 'a count on the right variant' }, fixture: `variant ${variant.id}` })
  }
  if (po) {
    scenarios.push({ id: 'po-receipt', kind: 'PO receipt (stopped)', turns: [`PO ${po.poNumber} arrived in full today.`], check: { type: 'wouldHave', tool: 'log_inventory_event', match: { type: 'RECEIVED' }, orAsks: true, what: 'RECEIVED against the order' }, fixture: `PO ${po.poNumber}` })
  }
  // The latest vendor email (never mail to support@): the question names the vendor only.
  const domainOf = (a: string) => a.toLowerCase().split('@')[1]?.replace(/>.*$/, '').trim() ?? ''
  const vendorByDomain = new Map(vendors.map((v) => [domainOf(v.email!), v.name]))
  const mail = mails.find((m) => vendorByDomain.has(domainOf(m.fromAddress)) && !/cleocamp\.com/.test(domainOf(m.fromAddress)))
  if (mail) {
    const vendor = vendorByDomain.get(domainOf(mail.fromAddress))!
    const words = (mail.subject ?? '').match(/[A-Za-z0-9]{4,}/g)?.filter((w) => !/^(re|fwd|from|your|with|this|that|order)$/i.test(w)) ?? []
    scenarios.push({ id: 'email', kind: 'email search', turns: [`What did ${vendor} last email us about?`], check: words.length ? { type: 'mentionsAny', values: words.slice(0, 4), what: "words from that email's subject" } : null, fixture: `latest email from ${vendor}` })
  } else missing.push('no email from a vendor on file')
  if (overdue.length) {
    scenarios.push({
      id: 'multi-round', kind: 'multi-round, two turns',
      turns: ['Which open purchase orders are past their due date, and what is still owed on each?', 'Which of those has been late the longest, and what did we last hear from that vendor?'],
      check: { type: 'mentionsAny', values: overdue.map((p) => String(p.poNumber)), what: 'an overdue PO' }, fixture: `${overdue.length} overdue POs`,
    })
  }
  return { scenarios, missing }
}

/** One layout's run of one scenario: its turns in order, as a conversation. */
async function runLayout(o: { layout: Layout; scenario: Scenario; runId: string; ledger: Ledger; signal: AbortSignal; client: Anthropic; lookUps: ReadonlySet<string> }): Promise<TurnResult[]> {
  const { runAgent } = await import('@/lib/mouse/agent')
  const { prefetchForMessage } = await import('@/lib/mouse/records')
  const { newEmailOpenBudget } = await import('@/lib/email-lookup')
  const catalogIndex = catalogIndexOn()
  const out: TurnResult[] = []
  const history: Anthropic.MessageParam[] = []
  for (const [turn, text] of o.scenario.turns.entries()) {
    const priced: Req[] = []
    // Per request: priced at its worst and reserved before it goes, settled to what it cost after.
    const pending = new Map<Anthropic.MessageCreateParamsNonStreaming, { worst: number; counted: number }>()
    const guard = {
      signal: o.signal,
      async beforeRequest(req: Anthropic.MessageCreateParamsNonStreaming) {
        if (o.signal.aborted) throw new Error('deadline reached before this request')
        if (o.ledger.tripped) throw new Error(o.ledger.tripped)
        // The prompt as sent, counted by the token-count endpoint (free). Thinking
        // and output are bounded by max_tokens, which the worst case prices in full.
        const counted = (await o.client.messages.countTokens({ model: req.model, system: req.system, tools: req.tools, messages: req.messages }, { signal: o.signal })).input_tokens
        const worst = worstCaseUsd(req.model, counted, req.max_tokens)
        if (!o.ledger.reserve(worst)) throw new Error(o.ledger.tripped ?? 'spend cap')
        pending.set(req, { worst, counted })
      },
      afterRequest(req: Anthropic.MessageCreateParamsNonStreaming, usage: Anthropic.Usage | null) {
        const p = pending.get(req)
        if (!p) return
        pending.delete(req)
        const row = usage ? { model: req.model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0, cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0 } : null
        const actual = row ? costOf(row) : null
        o.ledger.settle(p.worst, actual)
        priced.push({ ...(row ?? { model: req.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0 }), costUsd: actual ?? p.worst, worstCaseUsd: p.worst, countedInputTokens: p.counted })
      },
    }
    const started = Date.now()
    const r = await runAgent({
      instruction: text, source: BAKEOFF_SOURCE, practice: true, fromAPerson: true,
      notes: 'index', catalog: catalogIndex ? 'index' : 'full',
      chatThreadId: `bakeoff_${o.layout}_${o.runId}`, history: [...history],
      emailOpenBudget: newEmailOpenBudget(),
      shadowGuard: guard,
      ...(o.layout === 'live-tail'
        ? { liveTail: true, prefetch: await prefetchForMessage(text, { catalogue: catalogIndex }) }
        : { transient: { message: text, access: { actorName: 'Brandon', inventoryWrites: inventoryWritesEnabled(), shopifyWrites: inventoryWritesEnabled() } }, countStateTokens: true }),
    })
    const wallMs = Date.now() - started
    history.push({ role: 'user', content: text }, { role: 'assistant', content: r.text || '(no reply)' })
    // The runner's own per-request record (rounds, look-ups, state size), merged with the priced one, in order.
    const loopReqs = (r.usage.requests ?? []) as Array<Partial<Req>>
    const requests: Req[] = priced.map((p, i) => ({ ...p, ...(loopReqs[i] ? { durationMs: loopReqs[i].durationMs, toolRounds: loopReqs[i].toolRounds, fullRecordFetches: loopReqs[i].fullRecordFetches, transientChars: loopReqs[i].transientChars, transientTokens: loopReqs[i].transientTokens, effort: loopReqs[i].effort } : {}) }))
    const calls: Call[] = (r.toolCalls as Array<{ name: string; status: string; isWrite?: boolean; input?: unknown; result?: { skipped?: string } | null; resultChars?: number }>).map((c) => {
      const stopped = c.result?.skipped === 'practice'
      // Anything not stopped counts as having run, failed or not: stepFailure then
      // fails the bake-off if it was anything but a look-up.
      return { name: c.name, status: c.status, isWrite: c.isWrite, stopped, ran: !stopped, input: c.input, resultChars: c.resultChars ?? 0 }
    })
    out.push({
      layout: o.layout, turn, text: r.text, stopReason: r.usage.stopReason, providerError: r.usage.providerError ?? null,
      calls, requests, costUsd: requests.reduce((n, q) => n + q.costUsd, 0), wallMs,
      check: o.scenario.turns.length - 1 === turn ? runCheck(o.scenario.check, { text: r.text, calls }) : null,
    })
    if (r.usage.stopReason !== 'complete') break // a failed turn ends the scenario; the step fails
  }
  return out
}

export type BakeoffOutcome = 'not-production' | 'settled' | 'late' | 'busy' | 'lost-race' | 'unavailable' | 'stale-failed' | 'cannot-fit' | 'stepped' | 'complete' | 'failed'

// Per instance: once the bake-off is COMPLETE or FAILED, this instance never asks again.
let settled = false
export const resetBakeoffForTests = () => { settled = false }

export async function shadowBakeoffStep(o: {
  requestStartedAt: number
  now?: () => number
  env?: BakeoffEnv
  store?: BakeoffStore
  plan?: () => Promise<{ scenarios: Scenario[]; missing: string[] }>
  runScenario?: (a: { scenario: Scenario; ledger: Ledger; signal: AbortSignal; runId: string }) => Promise<TurnResult[]>
  lookUps?: ReadonlySet<string>
}): Promise<BakeoffOutcome> {
  const env = o.env ?? processEnv()
  const store = o.store ?? prismaStore
  const now = o.now ?? Date.now
  if (settled) return 'settled'
  if (env.vercelEnv !== 'production') return 'not-production'
  const elapsed = now() - o.requestStartedAt
  if (elapsed > LATEST_START_MS) return 'late'
  const codeVersion = env.commit ?? null
  const deploymentId = env.deploymentId ?? null
  const lookUps = o.lookUps ?? (await import('@/lib/mouse/agent')).PRACTICE_TOOLS

  let state: BakeoffState
  try {
    const row = await store.read()
    if (row && (row.status === 'COMPLETE' || row.status === 'FAILED')) { settled = true; return 'settled' }
    if (row && row.status === 'RUNNING') {
      const st = row.resultJson as BakeoffState
      const since = st?.stepStartedAt ? Date.parse(st.stepStartedAt) : row.startedAt.getTime()
      if (now() - since > STALE_STEP_MS) {
        await store.failStale(st, 'a step was cut off before it finished (the function ended mid-step); not resumed')
        settled = true
        return 'stale-failed'
      }
      return 'busy'
    }
    if (!row) {
      state = { phase: 'planning', scenarios: [], steps: [], spentUsd: 0, stepStartedAt: new Date(now()).toISOString(), plannedAt: new Date(now()).toISOString(), estimate: null }
      if (!(await store.claimNew(state, { codeVersion, deploymentId }))) return 'lost-race'
      const plan = await (o.plan ?? buildScenarios)()
      state.scenarios = plan.scenarios
      const fit = restFits(0, turnsIn(plan.scenarios))
      state.estimate = fit.detail
      if (plan.missing.length || !fit.ok) {
        const why = plan.missing.length ? `the set is incomplete, nothing was run: ${plan.missing.join('; ')}` : `the complete set cannot fit under the cap, nothing was run: ${fit.detail}`
        await store.save('FAILED', { ...state, phase: 'failed' }, why, report(state.scenarios, [], 0, why))
        settled = true
        return 'cannot-fit'
      }
    } else {
      state = { ...(row.resultJson as BakeoffState), stepStartedAt: new Date(now()).toISOString(), phase: 'running' }
      if (!(await store.claimNext(state))) return 'lost-race'
    }
  } catch (e) {
    // No table or no database: fail closed, quietly, for this instance. Nothing claimed, nothing spent.
    settled = true
    console.error('[shadow-bakeoff] lock unavailable; not running', e)
    return 'unavailable'
  }

  // One scenario: the next one not yet run.
  const index = state.steps.length
  const scenario = state.scenarios[index]
  const turnsLeft = turnsIn(state.scenarios.slice(index))
  const fit = restFits(state.spentUsd, turnsLeft)
  if (!scenario || !fit.ok) {
    const why = !scenario ? 'no scenario left to run, yet not marked complete' : `the rest of the set cannot fit under the cap, stopped before spending on it: ${fit.detail}`
    await store.save('FAILED', { ...state, phase: 'failed' }, why, report(state.scenarios, state.steps, state.spentUsd, why)).catch((e) => console.error('[shadow-bakeoff] could not record', e))
    settled = true
    return 'cannot-fit'
  }

  const ledger = new Ledger(state.spentUsd)
  const deadline = Math.max(0, ROUTE_BUDGET_MS - (now() - o.requestStartedAt))
  const signal = AbortSignal.timeout(deadline)
  const runId = `${state.plannedAt.replace(/[:.]/g, '-')}_${index}`
  const startedAt = new Date(now()).toISOString()
  const client = new Anthropic({ maxRetries: 0 })
  const run = o.runScenario ?? ((a) => Promise.all(LAYOUTS.map((layout) => runLayout({ ...a, layout, client, lookUps }))).then((x) => x.flat()))
  let turns: TurnResult[] = []
  let thrown: string | null = null
  try {
    turns = await run({ scenario, ledger, signal, runId })
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e)
  }
  const failure = thrown ?? ledger.tripped ?? (signal.aborted ? `deadline reached (${Math.round(deadline / 1000)} s)` : null) ?? stepFailure(turns, lookUps)
  const step: StepResult = {
    index, scenarioId: scenario.id, startedAt, finishedAt: new Date(now()).toISOString(), codeVersion, deploymentId,
    flags: { liveTailFlag: liveTailOn(), transientFlag: transientStateOn(), catalogIndex: catalogIndexOn(), inventoryWrites: inventoryWritesEnabled() },
    turns, failure,
  }
  const next: BakeoffState = { ...state, steps: [...state.steps, step], spentUsd: ledger.spent + ledger.outstanding, stepStartedAt: null }
  const last = next.steps.length === next.scenarios.length
  const status = failure ? 'FAILED' : last ? 'COMPLETE' : 'WAITING'
  next.phase = failure ? 'failed' : last ? 'complete' : 'waiting'
  try {
    await store.save(status, next, failure, report(next.scenarios, next.steps, next.spentUsd, failure))
  } catch (e) {
    // The row stays RUNNING and goes FAILED as stale; usage rows and this line are what is left.
    console.error('[shadow-bakeoff] could not record the step', { status, failure }, e)
  }
  if (status !== 'WAITING') settled = true
  return failure ? 'failed' : last ? 'complete' : 'stepped'
}

/**
 * Called by the chat route once a reply has completed and been saved. Off
 * production, or once this instance has seen the bake-off finish, it
 * schedules nothing at all.
 */
export function scheduleShadowBakeoff(requestStartedAt: number) {
  if (settled || process.env.VERCEL_ENV !== 'production') return
  after(async () => {
    try {
      const outcome = await shadowBakeoffStep({ requestStartedAt })
      if (outcome !== 'settled' && outcome !== 'busy') console.log(`[shadow-bakeoff] ${outcome}`)
    } catch (e) {
      console.error('[shadow-bakeoff] unexpected', e)
    }
  })
}

export { CAP_USD }
