import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import type { RequestUsage } from '@/lib/mouse/runner'

/**
 * Where every model request's token counts are kept — see ModelUsage in the
 * schema. Brandon, 24 Sept 2026: Mouse was costing "$10+ every couple of
 * days", and only chat turns recorded what they used, so the rest of the bill
 * could not be pinned on anything.
 *
 * Best-effort by design. A failed insert is logged and swallowed: losing a
 * row of accounting must never cost someone the reply, the brief or the
 * report it was counting.
 */
export async function recordUsage(source: string, requests: RequestUsage[]) {
  if (!requests.length) return
  try {
    await db.modelUsage.createMany({
      data: requests.map((r) => ({
        source,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        cacheWrite1hTokens: r.cacheWrite1hTokens,
        durationMs: r.durationMs,
      })),
    })
  } catch (e) {
    console.error(`[usage] could not record ${requests.length} request(s) for ${source}:`, e)
  }
}

/** The same, for the one-shot calls that go straight to messages.create. */
export function usageOf(model: string, u: Anthropic.Usage, startedAt: number): RequestUsage {
  return {
    model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    durationMs: Date.now() - startedAt,
  }
}
