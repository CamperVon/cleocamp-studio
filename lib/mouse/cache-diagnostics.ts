import { createHash } from 'node:crypto'

/**
 * Why a request missed the prompt cache, asked of Anthropic (11 Oct 2026).
 * Diagnostics only, behind MOUSE_CACHE_DIAGNOSTICS=1, off by default: it
 * changes no prompt, tool, model or setting Mouse runs with.
 *
 * In the week to 11 Oct, 73 chat requests wrote the whole context to the
 * cache again, $37.66 of $78.33. 48 of them came within five minutes of the
 * one before, so expiry does not explain them, and our own catalogue hashes
 * showed the stable block changing once all week. Something else in the
 * prefix moves. Anthropic's cache diagnostics compares a request with the
 * one named by `diagnostics.previous_message_id` and says where they first
 * diverged: model, system, tools or messages. The `diagnostics` object on the
 * request is the opt-in (no beta header); a fingerprint is kept only for
 * requests that carry it, as hashes and token estimates, never prompt text.
 *
 * What is kept here, per request, on the usage record: the response id, the
 * id it was compared with, the effort it ran at, Anthropic's reason and its
 * missed-token estimate. Per run: short hashes of each prefix block. No
 * prompt text, no tool input, no reply.
 *
 * The comparison that matters is across turns: the first request of a turn
 * against the last request of the previous turn that could share its cache
 * (same model, same lane). Within a run, each request is compared with the
 * one before it. Pure, apart from lastResponseId.
 */

export const cacheDiagnosticsOn = () => process.env.MOUSE_CACHE_DIAGNOSTICS === '1'

/** What one request's diagnosis said. */
export type CacheDiagnosis = {
  /** This response's id, for the next request to be compared with. */
  responseId: string
  /** What it was compared with; null when there was nothing to compare (first of its kind). */
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
export function diagnosisOf(responseId: string, previousId: string | null, d: Diagnostics): CacheDiagnosis {
  if (previousId === null) return { responseId, previousId, result: 'not-compared' }
  if (!d) return { responseId, previousId, result: 'no-divergence' }
  const r = d.cache_miss_reason
  if (!r) return { responseId, previousId, result: 'pending' }
  return {
    responseId, previousId, result: String(r.type),
    ...(typeof r.cache_missed_input_tokens === 'number' ? { missedTokens: r.cache_missed_input_tokens } : {}),
  }
}

/** The thread of ids through a run: every loop of the run shares one. */
export type DiagnosticsThread = { previousId: string | null }

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
}) {
  return {
    tools: short(JSON.stringify(p.tools)),
    rules: short(p.rules),
    extraRules: p.extraRules ? short(p.extraRules) : null,
    practiceRules: p.practiceRules ? short(p.practiceRules) : null,
    stable: p.stable ? short(p.stable) : null,
    live: p.live ? short(p.live) : null,
  }
}
export type PrefixHashes = ReturnType<typeof prefixHashes>

type SavedRequest = { model?: unknown; lane?: unknown; cacheDiagnosis?: { responseId?: unknown } | null }
type SavedUsage = { requests?: SavedRequest[]; route?: { attempt?: { requests?: SavedRequest[] } } } | null

/**
 * The newest response id among saved chat replies (newest first) from a
 * request with the same model and lane. A reply's own requests run after its
 * read-lane attempt, so they are looked at first. Pure.
 */
export function lastResponseIdFrom(usages: SavedUsage[], cohort: { model: string; lane: 'full' | 'read' }): string | null {
  for (const u of usages) {
    const runs = [u?.requests ?? [], u?.route?.attempt?.requests ?? []]
    for (const reqs of runs) {
      for (let i = reqs.length - 1; i >= 0; i--) {
        const r = reqs[i]
        const id = r?.cacheDiagnosis?.responseId
        if (typeof id === 'string' && r.model === cohort.model && (r.lane ?? 'full') === cohort.lane) return id
      }
    }
  }
  return null
}

/** The last chat request this one could share a cache with, from the saved replies. Best-effort. */
export async function lastResponseId(cohort: { model: string; lane: 'full' | 'read' }): Promise<string | null> {
  try {
    const { db } = await import('@/lib/db')
    const rows = await db.chatMessage.findMany({
      where: { role: 'ASSISTANT', createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { agentUsageJson: true },
    })
    return lastResponseIdFrom(rows.map((r) => r.agentUsageJson as SavedUsage), cohort)
  } catch (e) {
    console.error('[cache-diagnostics] could not find the previous response:', e)
    return null
  }
}
