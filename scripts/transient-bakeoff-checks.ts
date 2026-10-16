/**
 * The claims scripts/transient-bakeoff.ts makes, as pure functions, so the
 * judge is itself tested (tests/transient-bakeoff.test.ts) without spending
 * anything. Targets are Brandon's (16 Oct 2026); the rules for judging them
 * are Codex's review of the first harness (16 Oct 2026):
 *
 * - every required safety and factual check passes in BOTH layouts; a
 *   transient failure is never excused by a live-tail one, and a check whose
 *   fixture is missing fails rather than being skipped;
 * - a person judges all 13 paired replies, and every pair must be judged
 *   transient no worse;
 * - the state's size in tokens is the state alone, counted by Anthropic's
 *   token-count endpoint, never a request's input_tokens;
 * - the record-change schedule is production's proportion, not a guess;
 * - tool-result size is recorded, so a look-up cannot quietly rebuild the
 *   expensive prompt.
 */

export type Layout = 'live-tail' | 'transient'
export type Req = {
  model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number
  requestNumber?: number; toolRounds?: number; fullRecordFetches?: number; transientChars?: number; transientTokens?: number; transientTrimmed?: string[]
}
export type Call = { name: string; status: string; isWrite?: boolean; skippedPractice: boolean; input: unknown; resultChars: number }
export type TurnRun = {
  layout: Layout; kind: string; text: string; stopReason: string
  calls: Call[]; requests: Req[]; cost: number
  /** The automatic check: null only for a turn left wholly to the person (never a required one). */
  check: { ok: boolean; detail: string } | null
  /** Set when the turn's check could not be built (its record is missing): a failure, not a skip. */
  fixtureMissing?: string
  /** The cached core's hash for this turn (transient only). */
  coreHash?: string
}
export type Claim = { claim: string; ok: boolean; detail: string }
/** One person's verdict on one pair: transient no worse ('ok') or worse ('worse'). */
export type Review = Record<string, { verdict: 'ok' | 'worse' | null; notes?: string }>

export const TARGET = {
  /** Average counted state size over every transient request, in tokens. */
  maxAvgTransientTokens: 8_000,
  /** Transient cache writes as a share of live-tail's on the same turns. */
  maxWriteShare: 0.5,
  /** Projected cost per completed chat reply, dollars. */
  maxProjectedCost: 0.3,
} as const

/** Production's record churn, 24 hours to 16 Oct 2026: of 36 chat replies compared, 11 changed the live head and 3 only the tail. */
export const PRODUCTION_CHURN = { head: 11, tail: 3, of: 36 } as const

/**
 * Which replay turns get a scheduled record change, in production's
 * proportion: the counts are rounded shares of the turn count (13 turns:
 * 4 head and 1 tail-only), spread evenly after the first turn, with the
 * tail-only changes in the middle of the spread. Pure.
 */
export function churnSchedule(turns: number, c: { head: number; tail: number; of: number } = PRODUCTION_CHURN): Record<number, 'head' | 'tail'> {
  const head = Math.round((turns * c.head) / c.of)
  const tail = Math.round((turns * c.tail) / c.of)
  const n = head + tail
  const at = Array.from({ length: n }, (_, j) => 1 + Math.floor(((j + 0.5) * (turns - 1)) / n))
  const mid = Math.floor((n - tail) / 2)
  const out: Record<number, 'head' | 'tail'> = {}
  at.forEach((k, j) => { out[k] = j >= mid && j < mid + tail ? 'tail' : 'head' })
  return out
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a')

/** No real write ran in either layout: practice stopped every one. */
export function checkSafety(turns: TurnRun[]): Claim {
  const ran = turns.flatMap((t) => t.calls.filter((c) => c.isWrite && c.status === 'succeeded' && !c.skippedPractice).map((c) => `${t.layout}/${t.kind}: ${c.name}`))
  return { claim: 'safety: no write ran in either layout (practice stopped every one)', ok: ran.length === 0, detail: ran.length ? `ran: ${ran.join('; ')}` : `${sum(turns.map((t) => t.calls.filter((c) => c.skippedPractice).length))} writes stopped by practice, none ran` }
}

/** Every required check passes in both layouts; a missing fixture fails; every turn finished. */
export function checkRequired(turns: TurnRun[]): Claim[] {
  const failures: string[] = []
  for (const t of turns) {
    if (t.fixtureMissing) failures.push(`${t.layout}/${t.kind}: fixture missing (${t.fixtureMissing})`)
    else if (t.check && !t.check.ok) failures.push(`${t.layout}/${t.kind}: ${t.check.detail}`)
  }
  const required = new Set(turns.filter((t) => t.check || t.fixtureMissing).map((t) => t.kind))
  const unfinished = turns.filter((t) => t.stopReason !== 'complete').map((t) => `${t.layout}/${t.kind}: ${t.stopReason}`)
  return [
    { claim: 'required checks: every safety and factual check passes in BOTH layouts', ok: failures.length === 0, detail: failures.length ? failures.join(' | ') : `${required.size} required checks, all passed in both` },
    { claim: 'required checks: every turn finished in both layouts', ok: unfinished.length === 0, detail: unfinished.length ? unfinished.join('; ') : 'all complete' },
  ]
}

/** A person has judged every pair, and judged transient no worse on each. Pending until then. */
export function checkHumanReview(turns: TurnRun[], review: Review | null): Claim {
  const kinds = [...new Set(turns.map((t) => t.kind))]
  if (!review) return { claim: `human review: all ${kinds.length} paired replies judged transient no worse`, ok: false, detail: `PENDING: fill review.json (one verdict per pair), then run with --accept` }
  const missing = kinds.filter((k) => !review[k] || review[k].verdict === null)
  const worse = kinds.filter((k) => review[k]?.verdict === 'worse')
  return {
    claim: `human review: all ${kinds.length} paired replies judged transient no worse`,
    ok: missing.length === 0 && worse.length === 0,
    detail: missing.length ? `PENDING: no verdict yet for ${missing.join(', ')}` : worse.length ? `judged worse: ${worse.map((k) => `${k}${review[k].notes ? ` (${review[k].notes})` : ''}`).join('; ')}` : `all ${kinds.length} judged no worse`,
  }
}

/** The state's counted size: every transient request must have been counted, and the average must be within the target. */
export function checkSize(turns: TurnRun[]): Claim {
  const reqs = turns.filter((t) => t.layout === 'transient').flatMap((t) => t.requests)
  const counted = reqs.filter((q) => typeof q.transientTokens === 'number').map((q) => q.transientTokens!)
  const uncounted = reqs.length - counted.length
  const avg = counted.length ? sum(counted) / counted.length : Infinity
  const trimmed = reqs.flatMap((q) => q.transientTrimmed ?? [])
  const perChar = reqs.filter((q) => typeof q.transientTokens === 'number' && q.transientChars).map((q) => q.transientChars! / q.transientTokens!)
  return {
    claim: `size: the state, counted on its own by Anthropic's token-count endpoint, averages ${TARGET.maxAvgTransientTokens.toLocaleString('en-US')} tokens or less over every transient request`,
    ok: reqs.length > 0 && uncounted === 0 && avg <= TARGET.maxAvgTransientTokens,
    detail: `${counted.length} of ${reqs.length} requests counted${uncounted ? ` (${uncounted} NOT counted: not a pass)` : ''}; average ${Number.isFinite(avg) ? Math.round(avg) : 'n/a'}, max ${counted.length ? Math.max(...counted) : 'n/a'}${perChar.length ? `; ${(sum(perChar) / perChar.length).toFixed(2)} characters a token` : ''}${trimmed.length ? `; trimmed to fit: ${[...new Set(trimmed)].join(', ')}` : '; nothing trimmed'}`,
  }
}

export function totals(turns: TurnRun[], l: Layout) {
  const r = turns.filter((t) => t.layout === l).flatMap((t) => t.requests)
  const ts = turns.filter((t) => t.layout === l)
  const calls = ts.flatMap((t) => t.calls)
  return {
    turns: ts.length, requests: r.length, cost: sum(ts.map((t) => t.cost)),
    write: sum(r.map((q) => q.cacheWriteTokens)), write1h: sum(r.map((q) => q.cacheWrite1hTokens)), read: sum(r.map((q) => q.cacheReadTokens)),
    input: sum(r.map((q) => q.inputTokens)), output: sum(r.map((q) => q.outputTokens)),
    fetches: calls.filter((c) => ['open_record', 'query_status', 'read_file', 'open_email', 'list_records'].includes(c.name)).length,
    toolResultChars: sum(calls.map((c) => c.resultChars)), largestToolResult: Math.max(0, ...calls.map((c) => c.resultChars)),
    toolRounds: sum(ts.map((t) => Math.max(0, ...t.requests.map((q) => q.toolRounds ?? 0)))),
  }
}

/** At least half the cache writes gone, on the same turns. */
export function checkWrites(turns: TurnRun[]): Claim {
  const a = totals(turns, 'live-tail'), b = totals(turns, 'transient')
  return {
    claim: `cache writes: transient writes at most ${TARGET.maxWriteShare * 100}% of what live-tail writes on the same turns`,
    ok: a.write > 0 && b.write <= TARGET.maxWriteShare * a.write,
    detail: `transient ${b.write.toLocaleString('en-US')} vs live-tail ${a.write.toLocaleString('en-US')} tokens written (${pct(b.write, a.write)}); tool results: transient ${b.toolResultChars.toLocaleString('en-US')} chars (largest ${b.largestToolResult.toLocaleString('en-US')}), live-tail ${a.toolResultChars.toLocaleString('en-US')} (largest ${a.largestToolResult.toLocaleString('en-US')})`,
  }
}

/** The core did not change mid-replay (practice changes no record), or each change is named. */
export function checkCore(turns: TurnRun[]): Claim {
  const hashes = turns.filter((t) => t.layout === 'transient').map((t) => t.coreHash ?? '?')
  const changes = hashes.filter((h, i) => i > 0 && h !== hashes[i - 1]).length
  return { claim: 'core (information): the cached core\'s hash across the transient turns', ok: true, detail: changes ? `changed ${changes} time(s): each rewrote the core and the history behind it` : `unchanged on all ${hashes.length} turns` }
}

/**
 * The projection: production's own cost per completed chat reply under the
 * live-tail layout, scaled by what the two layouts actually cost on the same
 * replay. A ratio of two real bills, applied to a real bill; no simulator.
 */
export function checkProjection(turns: TurnRun[], productionPerReply: number, productionReplies: number): Claim {
  const a = totals(turns, 'live-tail'), b = totals(turns, 'transient')
  const ratio = a.cost ? b.cost / a.cost : Infinity
  const projected = productionPerReply * ratio
  return {
    claim: `cost: projected completed-chat cost about $${TARGET.maxProjectedCost.toFixed(2)} or below`,
    ok: Number.isFinite(projected) && projected <= TARGET.maxProjectedCost,
    detail: `replay: transient $${b.cost.toFixed(3)} vs live-tail $${a.cost.toFixed(3)} (ratio ${ratio.toFixed(3)}); production live-tail $${productionPerReply.toFixed(3)} per completed reply over ${productionReplies} replies → projected $${projected.toFixed(3)}`,
  }
}

/** Every claim, in the order they are printed. */
export function allClaims(turns: TurnRun[], o: { productionPerReply: number; productionReplies: number; review: Review | null }): Claim[] {
  return [checkSafety(turns), ...checkRequired(turns), checkHumanReview(turns, o.review), checkSize(turns), checkWrites(turns), checkProjection(turns, o.productionPerReply, o.productionReplies), checkCore(turns)]
}

/** One smoke-check request's usage (scripts/transient-smoke.ts). */
export type SmokeUsage = { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number }

/** The smoke check's verdicts, pure (tests/transient-bakeoff.test.ts). */
export function judgeSmoke(r: { cold: SmokeUsage; again: SmokeUsage; next: SmokeUsage; stateTokens: number[]; deltaTokens: number }) {
  const tol = 64
  return [
    { check: 'all three requests accepted with the four-mark layout', ok: true, detail: 'no request refused' },
    { check: 'cold: the one-hour marks wrote', ok: r.cold.cacheWrite1hTokens > 0, detail: `wrote ${r.cold.cacheWriteTokens}, of which 1h ${r.cold.cacheWrite1hTokens}` },
    { check: 'same turn, new state: nothing written, everything before the state read back', ok: r.again.cacheWriteTokens === 0 && r.again.cacheReadTokens >= r.cold.cacheReadTokens + r.cold.cacheWriteTokens - tol, detail: `write ${r.again.cacheWriteTokens}; read ${r.again.cacheReadTokens} of ${r.cold.cacheReadTokens + r.cold.cacheWriteTokens} cached` },
    { check: 'same turn: the uncached input is the state alone (within 64 tokens of its own count)', ok: Math.abs(r.again.inputTokens - r.stateTokens[1]) <= tol, detail: `uncached input ${r.again.inputTokens} vs state counted ${r.stateTokens[1]}` },
    { check: 'next turn: the earlier prefix read back, only the new messages written', ok: r.next.cacheReadTokens >= r.again.cacheReadTokens - tol && r.next.cacheWriteTokens <= r.deltaTokens + tol && r.next.cacheWrite1hTokens > 0, detail: `read ${r.next.cacheReadTokens} (previous ${r.again.cacheReadTokens}); wrote ${r.next.cacheWriteTokens} (1h ${r.next.cacheWrite1hTokens}) for about ${r.deltaTokens} new tokens` },
  ]
}
