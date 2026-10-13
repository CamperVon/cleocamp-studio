/**
 * The claims scripts/live-tail-replay.ts checks, as pure functions, so the
 * validator is itself tested (tests/live-tail-replay.test.ts) without
 * spending anything. Each claim names its tolerance and why.
 *
 * Wire measurements are one request each, made in this order within a few
 * minutes (well inside the five-minute cache lifetime):
 *
 *   warm         tail on, the real catalogue
 *   same         tail on, the identical request again
 *   tailEdit     tail on, one line added at the end of the tail
 *   headEdit     tail on, one line added at the end of the head
 *   offWarm      tail off (the three-block layout), the real catalogue
 *   offTailEdit  tail off, the same one line at the end of its live block
 *
 * Each run starts its live blocks with a line naming the run, so an earlier
 * run's cache can never make a write look smaller than it is.
 *
 * Sizes are measured, not estimated: Anthropic's token count of each block.
 */

export type Measured = { read: number; write: number; cost: number }
export type WireRun = {
  warm: Measured; same: Measured; tailEdit: Measured; headEdit: Measured; offWarm: Measured; offTailEdit: Measured
  /** Token counts of the tail-on head, the tail, and the tail-off live block. */
  tokens: { head: number; tail: number; live: number }
}
export type Claim = { claim: string; ok: boolean; detail: string }

export const TOLERANCE = {
  /** An identical request inside the cache lifetime writes nothing at all. Caching is exact: any write means the prefix moved. */
  identicalMaxWrite: 0,
  /** ...and reads back at least 98% of what the warm request had cached (its read plus its write); the 2% covers the request's own few uncached tokens being counted differently. */
  identicalMinReadShare: 0.98,
  /** A tail-only change writes at most half what the same change costs with the tail off. The tail is about a quarter of the live block in chat, so half leaves room and still fails a split that is not working. */
  tailOnlyMaxShareOfControl: 0.5,
  /** A head change writes at least 90% of head plus tail (both are behind it), and more than the tail-only change. */
  headEditMinShareOfHeadAndTail: 0.9,
  /** With the tail off, a one-line change at the end rewrites at least 90% of the whole live block: the cost the split exists to avoid. */
  offEditMinShareOfLive: 0.9,
} as const

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a')

/** Every wire claim, each with its numbers. Pure. */
export function checkWire(r: WireRun): Claim[] {
  const t = TOLERANCE
  const cached = r.warm.read + r.warm.write
  const headAndTail = r.tokens.head + r.tokens.tail
  return [
    {
      claim: 'identical second request: writes nothing and reads the cached prefix back',
      ok: r.same.write <= t.identicalMaxWrite && r.same.read > 0 && r.same.read >= t.identicalMinReadShare * cached,
      detail: `write ${r.same.write} (max ${t.identicalMaxWrite}); read ${r.same.read} of ${cached} cached (${pct(r.same.read, cached)}, min ${t.identicalMinReadShare * 100}%)`,
    },
    {
      claim: 'tail-only edit: a smaller and cheaper write than the same edit with the tail off',
      ok: r.tailEdit.write > 0 && r.tailEdit.write <= t.tailOnlyMaxShareOfControl * r.offTailEdit.write && r.tailEdit.cost < r.offTailEdit.cost,
      detail: `write ${r.tailEdit.write} vs control ${r.offTailEdit.write} (${pct(r.tailEdit.write, r.offTailEdit.write)}, max ${t.tailOnlyMaxShareOfControl * 100}%); ` +
        `cost $${r.tailEdit.cost.toFixed(4)} vs $${r.offTailEdit.cost.toFixed(4)}; tail is ${r.tokens.tail} tokens`,
    },
    {
      claim: 'head edit: a larger write than the tail-only edit, covering head and tail',
      ok: r.headEdit.write > r.tailEdit.write && r.headEdit.write >= t.headEditMinShareOfHeadAndTail * headAndTail,
      detail: `write ${r.headEdit.write} vs tail-only ${r.tailEdit.write}; head+tail ${headAndTail} tokens (${pct(r.headEdit.write, headAndTail)}, min ${t.headEditMinShareOfHeadAndTail * 100}%)`,
    },
    {
      claim: 'tail-off edit: rewrites the full live block',
      ok: r.offTailEdit.write >= t.offEditMinShareOfLive * r.tokens.live,
      detail: `write ${r.offTailEdit.write} of a ${r.tokens.live}-token live block (${pct(r.offTailEdit.write, r.tokens.live)}, min ${t.offEditMinShareOfLive * 100}%)`,
    },
  ]
}

export type PracticeTurn = {
  layout: 'off' | 'tail'
  kind: string
  stopReason: string
  reply: string
  /** Whether the run's catalogue actually had a tail block. */
  tailApplied: boolean
  /** Tool calls that changed something. Practice must have none. */
  writesRun: string[]
}

/**
 * The practice checks: every turn finished with a reply, no tool that
 * changes anything ran, and each layout was the one asked for. Whether the
 * two layouts' answers agree is for a person to read; the script prints
 * them side by side. Pure.
 */
export function checkPractice(turns: PracticeTurn[], kinds: string[]): Claim[] {
  const out: Claim[] = []
  for (const layout of ['off', 'tail'] as const) {
    for (const kind of kinds) {
      const t = turns.find((x) => x.layout === layout && x.kind === kind)
      out.push({
        claim: `practice, tail ${layout}, ${kind}: finished, replied, changed nothing, right layout`,
        ok: !!t && t.stopReason === 'complete' && t.reply.trim().length > 0 && t.writesRun.length === 0 && t.tailApplied === (layout === 'tail'),
        detail: !t ? 'turn missing' : `stop ${t.stopReason}; reply ${t.reply.trim().length} chars; writes run: ${t.writesRun.join(', ') || 'none'}; tail block ${t.tailApplied ? 'present' : 'absent'}`,
      })
    }
  }
  return out
}
