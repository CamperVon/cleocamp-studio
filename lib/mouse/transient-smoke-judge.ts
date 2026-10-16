/**
 * The smoke check's numbers and verdicts, pure: no imports, so they test
 * without a database. The check itself is lib/mouse/transient-smoke.ts.
 */

/** About what the three requests cost (docs/TRANSIENT-SHADOW-SMOKE.md, Spend). */
export const SMOKE_EXPECTED_USD = 0.2
/**
 * The hard ceiling. Before each request the run counts it (free) and prices
 * every input token as a one-hour cache write, the dearest way it can be
 * billed; a request is only sent if what has been spent plus that worst case
 * fits under this. A $0.20 ceiling cannot hold all three: each request carries
 * about 18,000 tokens of rules and core (about $0.15 if written), and the
 * worst case for requests 2 and 3 is the cache miss this check exists to find.
 */
export const SMOKE_CEILING_USD = 0.5
export const SMOKE_MAX_TOKENS = 16
/** The size gate on the real state, in tokens: Brandon's 8,000-token target for a normal turn. */
export const MAX_AVG_STATE_TOKENS = 8_000

export type SmokeUsage = { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number }

/** The smoke check's verdicts, pure (tests/shadow-smoke.test.ts). */
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
