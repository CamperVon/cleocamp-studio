// $ per million tokens: input, output, 5-minute cache write, 1-hour cache write, cache read.
// From platform.claude.com/docs/en/about-claude/pricing, read 8 Oct 2026. Cache
// reads on these two are 0.05x input, not the usual 0.1x: Sonnet's is $0.10.
// Moved here from scripts/cost-quality-audit.ts (16 Oct 2026) so app code can
// cap a spend with the same figures the audit reports with.
export const PRICES: Record<string, { in: number; out: number; w5: number; w1h: number; read: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, w5: 5, w1h: 8, read: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, w5: 2.5, w1h: 4, read: 0.1 },
}

export type PricedRequest = { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number; durationMs?: number | null }

export function costOf(r: PricedRequest): number | null {
  const p = PRICES[r.model]
  if (!p) return null
  // cacheWriteTokens is every cache write; the 1-hour ones are a subset of it.
  const w1h = r.cacheWrite1hTokens ?? 0
  const w5 = Math.max(0, (r.cacheWriteTokens ?? 0) - w1h)
  return (r.inputTokens * p.in + r.outputTokens * p.out + w5 * p.w5 + w1h * p.w1h + r.cacheReadTokens * p.read) / 1e6
}
