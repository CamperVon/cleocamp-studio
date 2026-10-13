import { createHash } from 'node:crypto'

/**
 * Why a request missed the prompt cache, asked of Anthropic (11 Oct 2026).
 * Diagnostics only, behind MOUSE_CACHE_DIAGNOSTICS=1, off by default: it
 * changes no prompt, tool, model or setting Mouse runs with.
 *
 * In the week to 11 Oct, 73 chat requests wrote the whole context to the
 * cache again, $37.66 of $78.33. 48 of them came within five minutes of the
 * one before, so expiry alone does not explain them, and our own catalogue
 * hashes showed the stable block changing once all week. Anthropic's cache
 * diagnostics compares a request with the one named by
 * `diagnostics.previous_message_id` and says where they first diverged:
 * model, system, tools or messages. The `diagnostics` object on the request
 * is the opt-in (no beta header); a fingerprint is kept only for requests
 * that carry it, as hashes and token estimates, never prompt text.
 *
 * Interactive chat only (chatTurn: chat, say, chat-practice). Background
 * runs have no durable place for these records, so they are left out of
 * this audit.
 *
 * What a request is compared with: the previous response in the same
 * conversation chain, which is the same chat thread, source, model, lane
 * and effort it actually ran at (Codex, 11 Oct 2026). Two different threads
 * are never treated as consecutive turns. Within a run the chain carries on
 * request to request; when the overthinking retry lowers the effort, the
 * low-effort request starts its own chain rather than being compared with a
 * high-effort one.
 *
 * What is kept, per request, on the usage record: the chain it belongs to,
 * the response id, the id it was compared with, the effort, Anthropic's
 * reason and its missed-token estimate. Per run (read-lane attempts
 * included): short hashes of each prefix block. No prompt text, no tool
 * input, no reply. Pure, apart from lastResponseId.
 */

export const cacheDiagnosticsOn = () => process.env.MOUSE_CACHE_DIAGNOSTICS === '1'

export type Effort = 'low' | 'medium' | 'high'

/** What one request's diagnosis said. */
export type CacheDiagnosis = {
  /** The conversation chain it belongs to: thread, source, model, lane, effort. */
  chain: string
  /** This response's id, for the next request in the chain to be compared with. */
  responseId: string
  /** What it was compared with; null when the chain had nothing before it. */
  previousId: string | null
  /**
   * 'not-compared' (no previous id), 'no-divergence', 'pending' (the
   * comparison had not finished when the response was sent), or Anthropic's
   * reason: model_changed, system_changed, tools_changed, messages_changed,
   * previous_message_not_found, unavailable; or 'request-refused' when the
   * API refused the field and the request went again without it.
   */
  result: string
  /** Anthropic's estimate of the prefix lost after the divergence, for the *_changed reasons. */
  missedTokens?: number
}

type Diagnostics = { cache_miss_reason: { type: string; cache_missed_input_tokens?: number } | null } | null | undefined

/** Anthropic's response diagnostics, read into a CacheDiagnosis. Pure. */
export function diagnosisOf(chain: string, responseId: string, previousId: string | null, d: Diagnostics): CacheDiagnosis {
  if (previousId === null) return { chain, responseId, previousId, result: 'not-compared' }
  if (!d) return { chain, responseId, previousId, result: 'no-divergence' }
  const r = d.cache_miss_reason
  if (!r) return { chain, responseId, previousId, result: 'pending' }
  return {
    chain, responseId, previousId, result: String(r.type),
    ...(typeof r.cache_missed_input_tokens === 'number' ? { missedTokens: r.cache_missed_input_tokens } : {}),
  }
}

/** Everything but the effort that scopes a chain. */
export type ChainScope = { threadId: string; source: string; model: string; lane: 'full' | 'read' }

/** The chain key: thread, source, model, lane and the effort a request ran at. Pure. */
export const chainKey = (s: ChainScope, effort: Effort) => [s.threadId, s.source, s.model, s.lane, effort].join('|')

/**
 * The chains a run carries, one per effort, shared by every loop of the
 * run. `last` holds the newest response id per chain key, seeded with the
 * previous turn's for the effort the run starts at.
 */
export type DiagnosticsChains = { scope: ChainScope; last: Record<string, string | null> }

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12)

/**
 * Short hashes of each block ahead of the conversation, so a reason like
 * system_changed can be pinned on the block that moved. Hashes only. Pure.
 */
export function prefixHashes(p: {
  tools: unknown[]
  rules: string
  extraRules?: string | null
  practiceRules?: string | null
  stable?: string | null
  live?: string | null
  tail?: string | null
}) {
  return {
    tools: short(JSON.stringify(p.tools)),
    rules: short(p.rules),
    extraRules: p.extraRules ? short(p.extraRules) : null,
    practiceRules: p.practiceRules ? short(p.practiceRules) : null,
    stable: p.stable ? short(p.stable) : null,
    live: p.live ? short(p.live) : null,
    tail: p.tail ? short(p.tail) : null,
  }
}
export type PrefixHashes = ReturnType<typeof prefixHashes>

type SavedRequest = { cacheDiagnosis?: { chain?: unknown; responseId?: unknown } | null }
type SavedRun = { requests?: SavedRequest[]; prefix?: PrefixHashes }
export type SavedUsage = (SavedRun & { route?: { attempt?: SavedRun } }) | null

/** A saved reply's runs in the order they ran: a read-lane attempt first, then the reply's own. Pure. */
export function runsOf(u: SavedUsage): SavedRun[] {
  if (!u) return []
  return [...(u.route?.attempt ? [u.route.attempt] : []), u]
}

/** The newest response id on the given chain among saved replies, newest reply first. Pure. */
export function lastResponseIdFrom(usages: SavedUsage[], chain: string): string | null {
  for (const u of usages) {
    for (const run of runsOf(u).reverse()) {
      const reqs = run.requests ?? []
      for (let i = reqs.length - 1; i >= 0; i--) {
        const d = reqs[i]?.cacheDiagnosis
        if (d?.chain === chain && typeof d.responseId === 'string') return d.responseId
      }
    }
  }
  return null
}

/** The previous response on this chain, from this thread's saved replies only. Best-effort. */
export async function lastResponseId(threadId: string, chain: string): Promise<string | null> {
  try {
    const { db } = await import('@/lib/db')
    const rows = await db.chatMessage.findMany({
      where: { threadId, role: 'ASSISTANT', createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { agentUsageJson: true },
    })
    return lastResponseIdFrom(rows.map((r) => r.agentUsageJson as SavedUsage), chain)
  } catch (e) {
    console.error('[cache-diagnostics] could not find the previous response:', e)
    return null
  }
}

/**
 * For each run's first request that was compared with an earlier response,
 * which prefix blocks differ between this run and the run that produced
 * exactly that earlier response (by id, never "the row before"). Runs in
 * any order; an earlier response not among them is reported as unlinked.
 * Pure.
 */
export function prefixAttribution(runs: Array<{ requests: Array<{ cacheDiagnosis?: CacheDiagnosis }>; prefix?: PrefixHashes }>) {
  const prefixOf = new Map<string, PrefixHashes>()
  for (const r of runs) {
    if (!r.prefix) continue
    for (const q of r.requests) if (q.cacheDiagnosis) prefixOf.set(q.cacheDiagnosis.responseId, r.prefix)
  }
  const out: Array<{ responseId: string; previousId: string; result: string; moved: string[] | 'unlinked' }> = []
  for (const r of runs) {
    const d = r.requests[0]?.cacheDiagnosis
    if (!d?.previousId) continue
    const before = prefixOf.get(d.previousId)
    const moved = !r.prefix || !before ? 'unlinked' as const
      : (Object.keys(r.prefix) as Array<keyof PrefixHashes>).filter((k) => r.prefix![k] !== before[k])
    out.push({ responseId: d.responseId, previousId: d.previousId, result: d.result, moved })
  }
  return out
}
