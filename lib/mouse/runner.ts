import type Anthropic from '@anthropic-ai/sdk'
import { classifyResult, completedWrites, diagnosticValue, type ToolOutcome } from './outcomes'

export type RequestUsage = {
  model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; durationMs: number
}
export type AgentUsage = {
  requests: RequestUsage[]
  attemptedRequests: number
  providerError: string | null
  durationMs: number
  stopReason: 'complete' | 'budget' | 'provider_error'
  escalationReason: string | null
}
export type LoopResult = {
  text: string; writes: Array<{ tool: string; summary: string }>; toolCalls: ToolOutcome[]
  model: string; escalated: string | null; usage: AgentUsage
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
  deepModel: string
  effort?: 'low' | 'medium' | 'high'
  maxRequests?: number
  maxOutputTokens?: number
}): Promise<LoopResult> {
  const started = Date.now()
  const maxRequests = Math.max(1, Math.min(12, Math.trunc(opts.maxRequests ?? 6)))
  const maxOutputTokens = Math.max(1024, Math.min(64000, Math.trunc(opts.maxOutputTokens ?? 24000)))
  const messages = [...opts.messages]
  const allowed = new Set(opts.tools.map(t => t.name))
  const calls: ToolOutcome[] = []
  const requests: RequestUsage[] = []
  let model = opts.model
  let escalated: string | null = null
  let spent = 0
  let text = ''
  let stopReason: AgentUsage['stopReason'] = 'budget'
  let attemptedRequests = 0
  let providerError: string | null = null

  for (let round = 0; round < maxRequests && spent < maxOutputTokens; round++) {
    const at = Date.now()
    let res: Response
    try {
      attemptedRequests++
      res = await opts.create({
        model, max_tokens: Math.min(8000, maxOutputTokens - spent),
        system: opts.system, tools: opts.tools, messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: opts.effort ?? (model === opts.deepModel ? 'high' : 'medium') },
      })
    } catch (e) {
      // Preserve outcomes from earlier rounds instead of losing them in a 500.
      stopReason = 'provider_error'
      providerError = String(diagnosticValue((e as Error).message))
      break
    }
    requests.push({ model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0, durationMs: Date.now() - at })
    spent += res.usage.output_tokens

    if (res.stop_reason !== 'tool_use') {
      text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      stopReason = res.stop_reason === 'end_turn' || res.stop_reason === 'stop_sequence' ? 'complete' : 'budget'
      break
    }

    messages.push({ role: 'assistant', content: res.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const u of res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')) {
      const atTool = Date.now()
      let result: unknown
      let error: string | undefined
      try {
        if (!allowed.has(u.name)) throw new Error('That tool is not available in this context.')
        if (u.name === 'request_deep_analysis') {
          if (model !== opts.deepModel && round + 1 < maxRequests && spent < maxOutputTokens) {
            model = opts.deepModel
            escalated = String(diagnosticValue((u.input as { reason?: string })?.reason ?? 'Further analysis requested')).slice(0, 500)
            result = { model, reason: escalated }
          } else result = { model, skipped: 'Already using deep analysis, or this turn has no reasoning budget remaining.' }
        } else {
          result = await opts.execute(u.name, u.input)
        }
      } catch (e) { error = String(diagnosticValue((e as Error).message)) }
      const classification = error ? { status: 'failed' as const, isWrite: false } : classifyResult(u.name, result)
      calls.push({ name: u.name, input: diagnosticValue(u.input), ...classification,
        result: diagnosticValue(result), ...(error ? { error } : {}), durationMs: Date.now() - atTool })
      results.push({ type: 'tool_result', tool_use_id: u.id, is_error: classification.status === 'failed',
        content: error ?? JSON.stringify(result ?? null, (_k, v) => typeof v === 'bigint' ? v.toString() : v) })
    }
    messages.push({ role: 'user', content: results })
  }

  if (stopReason !== 'complete') {
    const reason = stopReason === 'provider_error' ? 'The model connection failed' : 'I reached this turn’s reasoning limit'
    const failures = calls.filter(c => c.status === 'failed').length
    const done = completedWrites(calls).length
    const status = `${reason} before finishing. ${done ? `${done} action${done === 1 ? '' : 's'} completed; the saved changes remain.` : 'No completed changes were recorded.'}${failures ? ` ${failures} action${failures === 1 ? '' : 's'} failed; I have kept the diagnostic details.` : ''} Please continue from here; completed actions should not be repeated.`
    text = text ? `${text}\n\n${status}` : status
  }
  return { text, writes: completedWrites(calls), toolCalls: calls, model, escalated,
    usage: { requests, attemptedRequests, providerError, durationMs: Date.now() - started, stopReason, escalationReason: escalated } }
}

/** Non-chat callers must not close tasks or consume mail after an interrupted run. */
export function requireComplete(result: Pick<LoopResult, 'text' | 'usage'>) {
  if (result.usage.stopReason !== 'complete') throw new Error(result.text)
}
