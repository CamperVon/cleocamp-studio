import { isOutOfCredit, OUT_OF_CREDIT_TEXT } from './credit-text'
import type Anthropic from '@anthropic-ai/sdk'
import { classifyResult, completedWrites, diagnosticValue, type ToolOutcome } from './outcomes'

export type RequestUsage = {
  model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number
  /** The part of cacheWriteTokens written with the one-hour lifetime (billed 2x input, not 1.25x). */
  cacheWrite1hTokens: number
  durationMs: number
}
export type AgentUsage = {
  requests: RequestUsage[]
  attemptedRequests: number
  providerError: string | null
  durationMs: number
  stopReason: 'complete' | 'budget' | 'provider_error' | 'refusal'
  /** Catalogue section sizes and block hashes, set by runAgent (lib/mouse/context.ts catalogStats). */
  context?: import('./context').CatalogStats
  /** Which lane a chat turn took and why, set by chatTurn (lib/mouse/agent.ts, lib/mouse/route.ts). */
  route?: TurnRoute
}

/**
 * How a chat turn was routed. When a read-lane attempt was handed to Opus,
 * the attempt's cost is kept here for comparison, and nothing it wrote is.
 */
export type TurnRoute = {
  lane: 'opus' | 'read'
  reason: string
  model: string
  effort: 'low' | 'medium' | 'high'
  escalated?: boolean
  escalatedBecause?: string
  attempt?: { model: string; stopReason: AgentUsage['stopReason']; requests: RequestUsage[]; durationMs: number; tools: string[] }
}
export type LoopResult = {
  text: string; writes: Array<{ tool: string; summary: string }>; toolCalls: ToolOutcome[]
  model: string; usage: AgentUsage
}

type Request = Anthropic.MessageCreateParamsNonStreaming
type Response = Pick<Anthropic.Message, 'content' | 'stop_reason' | 'usage'>

/** Pure orchestration: production supplies SDK/tools; tests supply scripted responses. */
export async function runLoop(opts: {
  create: (request: Request) => Promise<Response>
  system: Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
  execute: (name: string, input: unknown) => Promise<unknown>
  model: string
  effort?: 'low' | 'medium' | 'high'
  maxRequests?: number
  maxOutputTokens?: number
  /** For tests: how to wait before retrying a request the server briefly refused. */
  sleep?: (ms: number) => Promise<void>
}): Promise<LoopResult> {
  const started = Date.now()
  const maxRequests = Math.max(1, Math.min(12, Math.trunc(opts.maxRequests ?? 6)))
  const maxOutputTokens = Math.max(1024, Math.min(64000, Math.trunc(opts.maxOutputTokens ?? 24000)))
  const messages = [...opts.messages]
  const allowed = new Set(opts.tools.map(t => t.name))
  const calls: ToolOutcome[] = []
  const requests: RequestUsage[] = []
  const model = opts.model
  let spent = 0
  let text = ''
  // What Mouse wrote alongside a tool call. On 25 Sept 2026 Brandon asked how
  // many Main and Cosmo labels were on hand; Mouse looked both up, wrote the
  // answer and, in the same step, retired a stale note. Only the words after
  // the last tool call were kept, so the reply read "Also retired the note…"
  // with no answer above it. Asked again, it answered from memory and was
  // wrong. Everything said to the person is kept now, in order.
  const said: string[] = []
  let stopReason: AgentUsage['stopReason'] = 'budget'
  let attemptedRequests = 0
  let providerError: string | null = null
  let effort = opts.effort
  let retriedOverthinking = false
  let retriedProvider = false
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  for (let round = 0; round < maxRequests && spent < maxOutputTokens; round++) {
    const at = Date.now()
    let res: Response
    try {
      attemptedRequests++
      res = await opts.create({
        // 16k, not 8k: on 23 Sept 2026 a long bag update from Brandon (three
        // orders, a pickup and a stock count) spent all 8,000 of a single
        // request thinking, made no tool call, and the turn ended "reasoning
        // limit" with two-thirds of its budget unspent.
        model, max_tokens: Math.min(16000, maxOutputTokens - spent),
        system: opts.system, tools: opts.tools, messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: effort ?? 'medium' },
      })
    } catch (e) {
      // The model's servers briefly unavailable (a 503 or "overloaded"): the
      // request never ran, so sending the same one again cannot repeat
      // anything. Once per turn. On 29 Sept 2026 "Add to todo: order more boy
      // belts in size small" came back "The model connection failed" after
      // two seconds, on a single 503, and the to-do was never made.
      if (!retriedProvider && isTransient(e)) {
        retriedProvider = true
        await sleep(2000)
        round--
        continue
      }
      // Preserve outcomes from earlier rounds instead of losing them in a 500.
      stopReason = 'provider_error'
      providerError = String(diagnosticValue((e as Error).message))
      break
    }
    requests.push({ model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      cacheWrite1hTokens: res.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0, durationMs: Date.now() - at })
    spent += res.usage.output_tokens

    // Ran out of room while still thinking, before doing anything at all.
    // Once per turn: ask again at low effort, told to start acting and work
    // through it a piece at a time rather than plan the whole list first.
    // The partial response is dropped, not replayed — it holds no tool call,
    // so nothing was done that could be repeated.
    if (
      res.stop_reason === 'max_tokens' &&
      !res.content.some(b => b.type === 'tool_use') &&
      !retriedOverthinking &&
      maxOutputTokens - spent >= 2048
    ) {
      retriedOverthinking = true
      effort = 'low'
      const last = messages[messages.length - 1]
      const nudge: Anthropic.TextBlockParam = {
        type: 'text',
        text:
          '(Your last attempt used all its room planning and did nothing. Start making the ' +
          'tool calls now, one item at a time, and think only as much as each step needs. ' +
          'If something is ambiguous, record what is clear and ask about the rest.)',
      }
      messages[messages.length - 1] = {
        ...last,
        content: typeof last.content === 'string'
          ? [{ type: 'text', text: last.content }, nudge]
          : [...last.content, nudge],
      }
      continue
    }

    // A safety classifier declined (and any server-side fallback too). Said
    // as what it is, so callers can retry on another model.
    if (res.stop_reason === 'refusal') {
      stopReason = 'refusal'
      break
    }

    if (res.stop_reason !== 'tool_use') {
      const final = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      text = [...said, final].filter(Boolean).join('\n\n')
      stopReason = res.stop_reason === 'end_turn' || res.stop_reason === 'stop_sequence' ? 'complete' : 'budget'
      break
    }

    const aside = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
    if (aside) said.push(aside)
    messages.push({ role: 'assistant', content: res.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const u of res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')) {
      const atTool = Date.now()
      let result: unknown
      let error: string | undefined
      try {
        if (!allowed.has(u.name)) throw new Error('That tool is not available in this context.')
        result = await opts.execute(u.name, u.input)
      } catch (e) { error = String(diagnosticValue((e as Error).message)) }
      const classification = error ? { status: 'failed' as const, isWrite: false } : classifyResult(u.name, result)
      calls.push({ name: u.name, input: diagnosticValue(u.input), ...classification,
        result: diagnosticValue(result), ...(error ? { error } : {}), durationMs: Date.now() - atTool })
      results.push({ type: 'tool_result', tool_use_id: u.id, is_error: classification.status === 'failed',
        content: error ?? toolResultContent(result) })
    }
    messages.push({ role: 'user', content: results })
  }

  if (stopReason !== 'complete') {
    const reason = stopReason === 'provider_error' ? 'The model connection failed'
      : stopReason === 'refusal' ? 'The model’s safety check declined this request'
      : 'I reached this turn’s reasoning limit'
    const failures = calls.filter(c => c.status === 'failed').length
    const done = completedWrites(calls).length
    const status = `${reason} before finishing. ${done ? `${done} action${done === 1 ? '' : 's'} completed; the saved changes remain.` : 'No completed changes were recorded.'}${failures ? ` ${failures} action${failures === 1 ? '' : 's'} failed; I have kept the diagnostic details.` : ''} Please continue from here; completed actions should not be repeated.`
    if (!text && said.length) text = said.join('\n\n')
    // Out of credit is a bill, not a glitch: say so in words a person acts on.
    const said2 = stopReason === 'provider_error' && isOutOfCredit(providerError)
      ? `${OUT_OF_CREDIT_TEXT}${done ? ` (${done} action${done === 1 ? '' : 's'} had already completed and stay saved.)` : ''}`
      : status
    text = text ? `${text}\n\n${said2}` : said2
  }
  return { text, writes: completedWrites(calls), toolCalls: calls, model,
    usage: { requests, attemptedRequests, providerError, durationMs: Date.now() - started, stopReason } }
}

/** A failure on the model provider's side that is worth one more try. Pure. */
export function isTransient(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status
  if (typeof status === 'number') return status === 429 || status === 529 || (status >= 500 && status < 600)
  return /\b(?:50[0-4]|529)\b|overloaded|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String((e as Error)?.message ?? e))
}

/** Non-chat callers must not close tasks or consume mail after an interrupted run. */
export function requireComplete(result: Pick<LoopResult, 'text' | 'usage'>) {
  if (result.usage.stopReason !== 'complete') throw new Error(result.text)
}

/**
 * What a tool's result looks like to the model. Normally its JSON. A result
 * carrying fileForModel (read_file, a kept PDF or photo) goes as the
 * document or image itself, then the rest as JSON, so Mouse reads the file
 * rather than a wall of base64. Pure.
 */
export function toolResultContent(result: unknown): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam> {
  const json = (v: unknown) => JSON.stringify(v ?? null, (_k, x) => typeof x === 'bigint' ? x.toString() : x)
  const r = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null
  const f = r?.fileForModel as { mediaType?: string; base64?: string } | undefined
  if (!r || !f?.base64 || !f.mediaType) return json(result)
  const { fileForModel: _file, ...rest } = r
  void _file
  const block: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam = f.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: f.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: f.base64 } }
  return [block, { type: 'text', text: json(rest) }]
}
