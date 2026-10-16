/**
 * The production shadow bake-off's rules and its report (Codex, 16 Oct 2026:
 * "the last cost-validation stage before Codex decides whether to enable
 * transient state or kill the approach"). Pure: no database, no API. The
 * runtime is lib/mouse/shadow-bakeoff.ts; the design and the cost ceiling
 * are in docs/TRANSIENT-SHADOW-BAKEOFF.md.
 *
 * Nothing here judges quality. The report sets each pair side by side and
 * measures; whether the answers are as good is Codex's call.
 */
import { PRICES } from '@/lib/mouse/prices'

export const BAKEOFF_KEY = 'transient-shadow-bakeoff'
/** The ModelUsage source every bake-off request is recorded under. */
export const BAKEOFF_SOURCE = 'transient-shadow-bakeoff'
/** Hard ceiling on the whole bake-off, every request of every step. */
export const CAP_USD = 10
/**
 * What one turn is expected to cost, for deciding before any spend whether
 * the rest of the set fits: production's own mean per completed chat reply
 * since the live tail went on (13 Oct 2026; $0.425 over 74 replies, measured
 * 16 Oct), plus 25%. The ceiling itself does not rest on this: every request
 * is priced at its worst before it is sent (worstCaseUsd).
 */
export const EST_TURN_USD = 0.425 * 1.25
/** A step starts only if the chat turn finished within this long of its request arriving. */
export const LATEST_START_MS = 100_000
/** A step must end by this point in the route's 300 s, leaving 20 s to write the result. */
export const ROUTE_BUDGET_MS = 280_000
/** A step left RUNNING longer than this was cut off mid-way; the bake-off is then failed, never resumed. */
export const STALE_STEP_MS = 10 * 60_000

export type Layout = 'live-tail' | 'transient'
export const LAYOUTS: readonly Layout[] = ['live-tail', 'transient']

/** An objective fact a reply can be checked for: reported, never used to judge quality. */
export type Check =
  | { type: 'mentions'; pattern: string; what: string }
  | { type: 'wouldHave'; tool: string; match: Record<string, unknown>; orAsks: boolean; what: string }
  | { type: 'mentionsAny'; values: string[]; what: string }

export type Scenario = { id: string; kind: string; turns: string[]; check: Check | null; fixture: string }

export type Call = { name: string; status: string; isWrite?: boolean; stopped: boolean; ran: boolean; input: unknown; resultChars: number }
export type Req = {
  model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number
  durationMs?: number | null; toolRounds?: number; fullRecordFetches?: number; transientChars?: number; transientTokens?: number; effort?: string
  costUsd: number; worstCaseUsd: number; countedInputTokens: number
}
export type TurnResult = { layout: Layout; turn: number; text: string; stopReason: string; providerError: string | null; calls: Call[]; requests: Req[]; costUsd: number; wallMs: number; check: { ok: boolean; detail: string } | null }
export type StepResult = {
  index: number; scenarioId: string; startedAt: string; finishedAt: string; codeVersion: string | null; deploymentId: string | null
  flags: { liveTailFlag: boolean; transientFlag: boolean; catalogIndex: boolean; inventoryWrites: boolean }
  turns: TurnResult[]; failure: string | null
}

/** A request's cost if every input token were written to the one-hour cache and every output token used: nothing it can bill is higher. */
export function worstCaseUsd(model: string, countedInputTokens: number, maxTokens: number): number {
  const p = PRICES[model]
  if (!p) return Infinity // a model the cap cannot price is never sent
  return (countedInputTokens * Math.max(p.in, p.w5, p.w1h) + maxTokens * p.out) / 1e6
}

/**
 * The bake-off's money. Every request reserves its worst case before it is
 * sent and settles to what it actually cost after; one that fails stays at
 * its worst case (an aborted request may still be billed). Spent plus
 * everything reserved can never pass the cap, so the cap is never passed.
 */
export class Ledger {
  spent: number
  private reserved = 0
  tripped: string | null = null
  constructor(spentBefore: number, readonly cap = CAP_USD) { this.spent = spentBefore }
  reserve(worst: number): boolean {
    if (!(worst >= 0) || this.spent + this.reserved + worst > this.cap) {
      this.tripped ??= `spend cap: $${this.spent.toFixed(4)} spent and $${this.reserved.toFixed(4)} reserved, this request could cost up to $${worst.toFixed(4)}, cap $${this.cap.toFixed(2)}`
      return false
    }
    this.reserved += worst
    return true
  }
  settle(worst: number, actual: number | null) {
    this.reserved -= worst
    this.spent += actual ?? worst
  }
  get outstanding() { return this.reserved }
}

/** Whether the rest of the set fits under the cap at the expected cost, before anything of it is spent. */
export function restFits(spent: number, turnsLeft: number): { ok: boolean; estimate: number; detail: string } {
  const estimate = spent + turnsLeft * EST_TURN_USD
  return { ok: estimate <= CAP_USD, estimate, detail: `$${spent.toFixed(4)} spent + ${turnsLeft} turns × $${EST_TURN_USD.toFixed(4)} = $${estimate.toFixed(2)} against the $${CAP_USD} cap` }
}

/** Every turn the whole set runs, both layouts. */
export const turnsIn = (scenarios: Scenario[]) => scenarios.reduce((n, s) => n + s.turns.length, 0) * LAYOUTS.length

/** A fact check on one turn's reply. Informational only. */
export function runCheck(check: Check | null, r: { text: string; calls: Call[] }): { ok: boolean; detail: string } | null {
  if (!check) return null
  if (check.type === 'mentions') {
    const ok = new RegExp(check.pattern, 'i').test(r.text)
    return { ok, detail: ok ? `says ${check.what}` : `does not say ${check.what}` }
  }
  if (check.type === 'mentionsAny') {
    const hit = check.values.find((v) => r.text.includes(v))
    return { ok: !!hit, detail: hit ? `names ${hit} (${check.what})` : `names none of ${check.values.join(', ')} (${check.what})` }
  }
  const got = r.calls.find((c) => c.name === check.tool && c.stopped && Object.entries(check.match).every(([k, v]) => (c.input as Record<string, unknown> | null)?.[k] === v))
  if (got) return { ok: true, detail: `would have called ${check.tool} (${check.what}); stopped` }
  if (check.orAsks && /\?/.test(r.text)) return { ok: true, detail: 'asked before acting' }
  return { ok: false, detail: `neither would have called ${check.tool} (${check.what}) nor asked` }
}

/** What makes a step a failure, in order. Any one fails the whole bake-off, for good. */
export function stepFailure(turns: TurnResult[], lookUps: ReadonlySet<string>): string | null {
  const ran = turns.flatMap((t) => t.calls.filter((c) => c.ran && !lookUps.has(c.name)).map((c) => `${t.layout} ran ${c.name}`))
  if (ran.length) return `a write risk: ${ran.join('; ')} (only look-ups may run)`
  const bad = turns.find((t) => t.stopReason !== 'complete')
  if (bad) return `${bad.layout} turn ${bad.turn + 1} did not complete (${bad.stopReason}${bad.providerError ? `: ${bad.providerError}` : ''})`
  return null
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 }

export type LayoutTotals = {
  turns: number; completed: number; requests: number; costUsd: number; costPerCompletedTurn: number | null
  latencyMs: { median: number; max: number; total: number }; modelMs: number
  cacheWrite: number; cacheWrite1h: number; cacheWrite5m: number; cacheRead: number; uncachedInput: number; output: number
  firstRequestCost: number; laterRequestsCost: number
  toolCalls: number; toolRounds: number; lookUps: number; stoppedWrites: number; stateTokens: { median: number; max: number } | null
}

export function layoutTotals(turns: TurnResult[], layout: Layout): LayoutTotals {
  const ts = turns.filter((t) => t.layout === layout)
  const reqs = ts.flatMap((t) => t.requests)
  const done = ts.filter((t) => t.stopReason === 'complete')
  const cost = sum(ts.map((t) => t.costUsd))
  const states = reqs.map((r) => r.transientTokens).filter((n): n is number => typeof n === 'number')
  return {
    turns: ts.length, completed: done.length, requests: reqs.length, costUsd: cost,
    costPerCompletedTurn: done.length ? sum(done.map((t) => t.costUsd)) / done.length : null,
    latencyMs: { median: median(ts.map((t) => t.wallMs)), max: Math.max(0, ...ts.map((t) => t.wallMs)), total: sum(ts.map((t) => t.wallMs)) },
    modelMs: sum(reqs.map((r) => r.durationMs ?? 0)),
    cacheWrite: sum(reqs.map((r) => r.cacheWriteTokens)), cacheWrite1h: sum(reqs.map((r) => r.cacheWrite1hTokens)),
    cacheWrite5m: sum(reqs.map((r) => r.cacheWriteTokens - r.cacheWrite1hTokens)),
    cacheRead: sum(reqs.map((r) => r.cacheReadTokens)), uncachedInput: sum(reqs.map((r) => r.inputTokens)), output: sum(reqs.map((r) => r.outputTokens)),
    firstRequestCost: sum(ts.map((t) => t.requests[0]?.costUsd ?? 0)), laterRequestsCost: sum(ts.map((t) => sum(t.requests.slice(1).map((r) => r.costUsd)))),
    toolCalls: sum(ts.map((t) => t.calls.length)), toolRounds: sum(reqs.map((r, i, a) => (i === a.length - 1 || (a[i + 1]?.toolRounds ?? 0) < (r.toolRounds ?? 0) ? r.toolRounds ?? 0 : 0))),
    lookUps: sum(ts.map((t) => t.calls.filter((c) => c.ran).length)), stoppedWrites: sum(ts.map((t) => t.calls.filter((c) => c.stopped).length)),
    stateTokens: states.length ? { median: median(states), max: Math.max(...states) } : null,
  }
}

export type Report = {
  status: 'complete' | 'failed' | 'incomplete'
  quality: string
  spentUsd: number; capUsd: number
  codeVersions: string[]
  totals: Record<Layout, LayoutTotals>
  transientVsLiveTail: { costPerCompletedTurn: number | null; latencyMedian: number | null; cacheWrite: number | null }
  pairs: Array<{ scenario: string; kind: string; question: string[]; replies: Record<Layout, Array<{ text: string; stopReason: string; costUsd: number; wallMs: number; requests: number; tools: string[]; check: string | null }>> }>
  failure: string | null
  nextStep: string
}

/** The judge's report: measured, side by side, no verdict on quality. Pure. */
export function report(scenarios: Scenario[], steps: StepResult[], spentUsd: number, failure: string | null): Report {
  const turns = steps.flatMap((s) => s.turns)
  const totals = { 'live-tail': layoutTotals(turns, 'live-tail'), transient: layoutTotals(turns, 'transient') }
  const ratio = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null)
  const done = steps.length === scenarios.length && !failure
  return {
    status: failure ? 'failed' : done ? 'complete' : 'incomplete',
    quality: 'NOT JUDGED. Equivalence of answers is not claimed or scored here; each pair below is for Codex to read. The fact checks are informational only.',
    spentUsd, capUsd: CAP_USD,
    codeVersions: [...new Set(steps.map((s) => s.codeVersion ?? 'unknown'))],
    totals,
    transientVsLiveTail: {
      costPerCompletedTurn: ratio(totals.transient.costPerCompletedTurn, totals['live-tail'].costPerCompletedTurn),
      latencyMedian: ratio(totals.transient.latencyMs.median, totals['live-tail'].latencyMs.median),
      cacheWrite: ratio(totals.transient.cacheWrite, totals['live-tail'].cacheWrite),
    },
    pairs: steps.map((s) => {
      const sc = scenarios.find((x) => x.id === s.scenarioId)
      const of = (l: Layout) => s.turns.filter((t) => t.layout === l).sort((a, b) => a.turn - b.turn).map((t) => ({
        text: t.text, stopReason: t.stopReason, costUsd: t.costUsd, wallMs: t.wallMs, requests: t.requests.length,
        tools: t.calls.map((c) => `${c.name}${c.stopped ? ' (stopped)' : ''}`), check: t.check ? `${t.check.ok ? 'PASS' : 'FAIL'}: ${t.check.detail}` : null,
      }))
      return { scenario: s.scenarioId, kind: sc?.kind ?? s.scenarioId, question: sc?.turns ?? [], replies: { 'live-tail': of('live-tail'), transient: of('transient') } }
    }),
    failure,
    nextStep: 'Codex review only: enable transient state for a controlled canary, or abandon it. No further cache-splitting proposals.',
  }
}
