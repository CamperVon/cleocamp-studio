/**
 * The claims scripts/transient-bakeoff.ts makes, as pure functions, so the
 * judge is itself tested (tests/transient-bakeoff.test.ts) without spending
 * anything. Targets are Brandon's (16 Oct 2026): no safety or quality
 * regression, an average state of 8,000 tokens or less on normal turns, at
 * least 50% fewer cache writes than the live-tail layout on the same turns,
 * and a projected completed-chat cost around $0.30 or below.
 */

export type Layout = 'live-tail' | 'transient'
export type Req = {
  model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number
  requestNumber?: number; toolRounds?: number; fullRecordFetches?: number; transientChars?: number; transientTokens?: number; transientTrimmed?: string[]
}
export type Call = { name: string; status: string; isWrite?: boolean; skippedPractice: boolean; input: unknown }
export type TurnRun = {
  layout: Layout; kind: string; heavy: boolean; text: string; stopReason: string
  calls: Call[]; requests: Req[]; cost: number
  /** null: for a person to judge (printed side by side). */
  check: { ok: boolean; detail: string } | null
}
export type Claim = { claim: string; ok: boolean; detail: string }

export const TARGET = {
  /** Average measured state on normal turns, in tokens. */
  maxAvgTransientTokens: 8_000,
  /** Transient cache writes as a share of live-tail's on the same turns. */
  maxWriteShare: 0.5,
  /** Projected cost per completed chat reply, dollars. */
  maxProjectedCost: 0.3,
} as const

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a')

/** No real write ran in either layout: practice stopped every one. */
export function checkSafety(turns: TurnRun[]): Claim {
  const ran = turns.flatMap((t) => t.calls.filter((c) => c.isWrite && c.status === 'succeeded' && !c.skippedPractice).map((c) => `${t.layout}/${t.kind}: ${c.name}`))
  return { claim: 'safety: no write ran in either layout (practice stopped every one)', ok: ran.length === 0, detail: ran.length ? `ran: ${ran.join('; ')}` : `${sum(turns.map((t) => t.calls.filter((c) => c.skippedPractice).length))} writes stopped by practice, none ran` }
}

/** Every automatic check live-tail passes, transient passes too; and both finished every turn. */
export function checkQuality(turns: TurnRun[]): Claim[] {
  const kinds = [...new Set(turns.map((t) => t.kind))]
  const of = (l: Layout, k: string) => turns.find((t) => t.layout === l && t.kind === k)
  const regressions: string[] = []
  const failures: string[] = []
  for (const k of kinds) {
    const a = of('live-tail', k), b = of('transient', k)
    if (!a || !b) { regressions.push(`${k}: missing a layout`); continue }
    if (a.check && b.check && a.check.ok && !b.check.ok) regressions.push(`${k}: ${b.check.detail}`)
    for (const t of [a, b]) if (t.check && !t.check.ok) failures.push(`${t.layout}/${k}: ${t.check.detail}`)
  }
  const unfinished = turns.filter((t) => t.stopReason !== 'complete').map((t) => `${t.layout}/${t.kind}: ${t.stopReason}`)
  return [
    { claim: 'quality: transient fails no automatic check that live-tail passes', ok: regressions.length === 0, detail: regressions.length ? regressions.join(' | ') : `${kinds.length} turns compared` },
    { claim: 'quality: every turn finished in both layouts', ok: unfinished.length === 0, detail: unfinished.length ? unfinished.join('; ') : 'all complete' },
    { claim: 'quality (information): automatic checks failed in either layout', ok: true, detail: failures.length ? failures.join(' | ') : 'none' },
  ]
}

/** The state's measured size: average over the normal turns' requests, with the heavy ones and the largest shown. */
export function checkSize(turns: TurnRun[]): Claim {
  const reqs = (heavy: boolean | null) => turns.filter((t) => t.layout === 'transient' && (heavy === null || t.heavy === heavy)).flatMap((t) => t.requests).filter((q) => typeof q.transientTokens === 'number')
  const normal = reqs(false).map((q) => q.transientTokens!)
  const all = reqs(null).map((q) => q.transientTokens!)
  const avg = normal.length ? sum(normal) / normal.length : Infinity
  const trimmed = turns.filter((t) => t.layout === 'transient').flatMap((t) => t.requests.flatMap((q) => q.transientTrimmed ?? []))
  return {
    claim: `size: the state averages ${TARGET.maxAvgTransientTokens.toLocaleString('en-US')} tokens or less on normal turns (measured: the request's uncached input)`,
    ok: normal.length > 0 && avg <= TARGET.maxAvgTransientTokens,
    detail: `normal turns: ${normal.length} requests, average ${Math.round(avg)}, max ${normal.length ? Math.max(...normal) : 0}; all turns: average ${all.length ? Math.round(sum(all) / all.length) : 0}, max ${all.length ? Math.max(...all) : 0}${trimmed.length ? `; trimmed to fit: ${[...new Set(trimmed)].join(', ')}` : '; nothing trimmed'}`,
  }
}

export function totals(turns: TurnRun[], l: Layout) {
  const r = turns.filter((t) => t.layout === l).flatMap((t) => t.requests)
  const ts = turns.filter((t) => t.layout === l)
  return {
    turns: ts.length, requests: r.length, cost: sum(ts.map((t) => t.cost)),
    write: sum(r.map((q) => q.cacheWriteTokens)), write1h: sum(r.map((q) => q.cacheWrite1hTokens)), read: sum(r.map((q) => q.cacheReadTokens)),
    input: sum(r.map((q) => q.inputTokens)), output: sum(r.map((q) => q.outputTokens)),
    fetches: sum(ts.map((t) => t.calls.filter((c) => ['open_record', 'query_status', 'read_file', 'open_email'].includes(c.name)).length)),
    toolRounds: sum(ts.map((t) => Math.max(0, ...t.requests.map((q) => q.toolRounds ?? 0)))),
  }
}

/** At least half the cache writes gone, on the same turns. */
export function checkWrites(turns: TurnRun[]): Claim {
  const a = totals(turns, 'live-tail'), b = totals(turns, 'transient')
  return {
    claim: `cache writes: transient writes at most ${TARGET.maxWriteShare * 100}% of what live-tail writes on the same turns`,
    ok: a.write > 0 && b.write <= TARGET.maxWriteShare * a.write,
    detail: `transient ${b.write.toLocaleString('en-US')} vs live-tail ${a.write.toLocaleString('en-US')} tokens written (${pct(b.write, a.write)})`,
  }
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
