import Anthropic from '@anthropic-ai/sdk'
import { CHAT_MODEL, countStateTokens } from '@/lib/mouse/agent'
import { coreSystemBlocks, layoutTransientMessages } from '@/lib/mouse/cache-blocks'
import { buildCatalogParts } from '@/lib/mouse/context'
import { costOf, PRICES } from '@/lib/mouse/prices'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { prefetchForMessage } from '@/lib/mouse/records'
import { buildDirectory, buildTransientState, TRANSIENT_RULES, transientStateOn } from '@/lib/mouse/transient'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import type { RequestUsage } from '@/lib/mouse/runner'
import { judgeSmoke, MAX_AVG_STATE_TOKENS, SMOKE_CEILING_USD, SMOKE_MAX_TOKENS } from '@/lib/mouse/transient-smoke-judge'

export * from '@/lib/mouse/transient-smoke-judge'

/**
 * The transient-layout smoke check, as a function (16 Oct 2026), so the CLI
 * (scripts/transient-smoke.ts) and the one-time production shadow run
 * (lib/mouse/shadow-smoke.ts) send exactly the same three requests. What it
 * proves and why is in the CLI's header.
 *
 * Read-only by construction: the requests carry no tools, so the model cannot
 * ask for a write; the state builders it calls only read; it sends no email
 * and writes no chat message. The only rows it writes are its own ModelUsage
 * accounting, under the source it is given.
 */

/** One request as recorded: Anthropic's own counts, the 5-minute writes split out, and its price. */
export type SmokeRequest = RequestUsage & { label: string; cacheWrite5mTokens: number; costUsd: number; worstCaseUsd: number }
export type SmokeCheck = { check: string; ok: boolean; detail: string }
export type SmokeResult = {
  ok: boolean
  runId: string
  source: string
  codeVersion: string | null
  model: string
  /** MOUSE_TRANSIENT_STATE as the run found it. The run never sets it. */
  transientStateOn: boolean
  ceilingUsd: number
  spentUsd: number
  requests: SmokeRequest[]
  usage: { cold?: SmokeRequest; again?: SmokeRequest; next?: SmokeRequest }
  stateTokens: number[]
  deltaTokens: number | null
  realStates: Array<{ message: string; chars: number; tokens: number | undefined }>
  checks: SmokeCheck[]
  /** Why it stopped short, verbatim: a refusal from the API, the ceiling, the deadline, anything else. */
  error: { kind: 'refused' | 'budget' | 'deadline' | 'other'; message: string; status?: number } | null
}

export class SmokeBudgetError extends Error {}

export type SmokeOptions = {
  client: Anthropic
  /** The ModelUsage source the requests are recorded under. */
  source: string
  codeVersion?: string | null
  ceilingUsd?: number
  signal?: AbortSignal
  log?: (line: string) => void
  /** Injected in tests; ModelUsage otherwise. */
  record?: (source: string, requests: RequestUsage[]) => Promise<void>
  /** Injected in tests; the real core and state otherwise. */
  core?: () => Promise<{ rules: string; transientRules: string; core: string }>
  realState?: (message: string) => Promise<{ text: string; chars: number }>
}

const SAMPLES = ['Morning, anything urgent?', 'How many Cleo Tees do we have?', 'What lining does the Story Dress use?', 'PO 2409 arrived in full today.', 'Which open purchase orders are past their due date?']

async function realCore() {
  const [parts, directory] = await Promise.all([buildCatalogParts({ notes: 'index', catalog: 'index' }), buildDirectory()])
  return { rules: SYSTEM_RULES, transientRules: TRANSIENT_RULES, core: `${parts.stable}\n${directory}` }
}

const realStateFor = (m: string) => buildTransientState({ practice: true, lane: 'full', actorName: 'Brandon', inventoryWrites: true, shopifyWrites: true }, () => prefetchForMessage(m, { catalogue: true }))

/**
 * Runs the check and always returns a result: a refused layout, the ceiling
 * or the deadline end it early with the reason and whatever usage came back,
 * never an exception the caller has to piece the spend back together from.
 */
export async function runTransientSmoke(o: SmokeOptions): Promise<SmokeResult> {
  const { client, source, signal } = o
  const model = CHAT_MODEL
  const ceilingUsd = o.ceilingUsd ?? SMOKE_CEILING_USD
  const log = o.log ?? (() => {})
  const record = o.record ?? recordUsage
  const res: SmokeResult = {
    ok: false, runId: new Date().toISOString(), source, codeVersion: o.codeVersion ?? null, model,
    transientStateOn: transientStateOn(), ceilingUsd, spentUsd: 0,
    requests: [], usage: {}, stateTokens: [], deltaTokens: null, realStates: [], checks: [], error: null,
  }
  const price = PRICES[model]
  try {
    if (!price) throw new SmokeBudgetError(`no price for ${model}, so the spend cannot be capped; nothing was sent`)
    const opts = signal ? { signal } : undefined
    const c = await (o.core ?? realCore)()
    const system = coreSystemBlocks({ rules: c.rules, transientRules: c.transientRules, core: c.core })
    // A short made-up exchange, the same every run apart from its first line,
    // which names the run so no earlier run's cache can make a write look smaller.
    const pad = (s: string) => `${s} ${'This is filler text for the smoke check, kept to make the history long enough to cache. '.repeat(30)}`
    const history: Anthropic.MessageParam[] = [
      { role: 'user', content: pad(`Smoke run ${res.runId}. Morning.`) },
      { role: 'assistant', content: pad('Morning. Nothing urgent.') },
      { role: 'user', content: pad('Thanks.') },
      { role: 'assistant', content: pad('You are welcome.') },
    ]
    const ask: Anthropic.MessageParam = { role: 'user', content: 'Reply with the single word OK.' }
    const state = (n: number) => `<business_state as_of="smoke-${n}">\nReference data for the smoke check, request ${n}. ${'Row of made-up state. '.repeat(40)}\n</business_state>`
    const count = async (messages: Anthropic.MessageParam[], withSystem = false) =>
      (await client.messages.countTokens({ model, messages, ...(withSystem ? { system } : {}) }, opts)).input_tokens
    const base = await count([{ role: 'user', content: [{ type: 'text', text: '.' }] }])
    res.stateTokens = [await count([{ role: 'user', content: [{ type: 'text', text: state(1) }] }]) - base, await count([{ role: 'user', content: [{ type: 'text', text: state(2) }] }]) - base]

    const send = async (label: string, messages: Anthropic.MessageParam[]) => {
      signal?.throwIfAborted()
      const worstCaseUsd = ((await count(messages, true)) * price.w1h + SMOKE_MAX_TOKENS * price.out) / 1e6
      if (res.spentUsd + worstCaseUsd > ceilingUsd) {
        throw new SmokeBudgetError(`request "${label}" could cost up to $${worstCaseUsd.toFixed(4)} on top of $${res.spentUsd.toFixed(4)} spent, over the $${ceilingUsd.toFixed(2)} ceiling; not sent`)
      }
      const startedAt = Date.now()
      // No tools, ever: a reply can only be text.
      const reply = await client.messages.create({ model, max_tokens: SMOKE_MAX_TOKENS, system, messages }, opts)
      const q = usageOf(model, reply.usage, startedAt)
      await record(source, [q])
      const r: SmokeRequest = { ...q, label, cacheWrite5mTokens: Math.max(0, q.cacheWriteTokens - q.cacheWrite1hTokens), costUsd: costOf(q) ?? worstCaseUsd, worstCaseUsd }
      res.spentUsd += r.costUsd
      res.requests.push(r)
      log(`${label.padEnd(28)} in ${q.inputTokens} · read ${q.cacheReadTokens} · write 1h ${q.cacheWrite1hTokens} / 5m ${r.cacheWrite5mTokens} · out ${q.outputTokens} · $${r.costUsd.toFixed(4)}`)
      return r
    }
    const turn1 = [...history, ask]
    res.usage.cold = await send('1 cold', layoutTransientMessages(turn1, history.length, state(1)))
    res.usage.again = await send('2 same turn, new state', layoutTransientMessages(turn1, history.length, state(2)))
    const grown: Anthropic.MessageParam[] = [...turn1, { role: 'assistant', content: 'OK' }]
    const ask2: Anthropic.MessageParam = { role: 'user', content: 'And once more: reply OK.' }
    res.deltaTokens = await count([...grown, ask2]) - await count(turn1)
    res.usage.next = await send('3 next turn', layoutTransientMessages([...grown, ask2], grown.length, state(1)))

    // The real state, counted (free): five representative messages.
    for (const m of SAMPLES) {
      signal?.throwIfAborted()
      const st = await (o.realState ?? realStateFor)(m)
      res.realStates.push({ message: m, chars: st.chars, tokens: await countStateTokens(client, model, st.text) })
    }
    for (const r of res.realStates) log(`state for "${r.message}": ${r.chars} chars, ${r.tokens ?? 'NOT COUNTED'} tokens`)
    const counted = res.realStates.map((r) => r.tokens).filter((n): n is number => typeof n === 'number')
    const avg = counted.length === res.realStates.length ? counted.reduce((a, b) => a + b, 0) / counted.length : Infinity
    res.checks = [
      ...judgeSmoke({ cold: res.usage.cold, again: res.usage.again, next: res.usage.next, stateTokens: res.stateTokens, deltaTokens: res.deltaTokens }),
      { check: `real state: the five sample states average ${MAX_AVG_STATE_TOKENS.toLocaleString('en-US')} tokens or less, counted`, ok: avg <= MAX_AVG_STATE_TOKENS, detail: `average ${Number.isFinite(avg) ? Math.round(avg) : 'not all counted'}, max ${counted.length ? Math.max(...counted) : 'n/a'}` },
    ]
    res.ok = res.checks.every((c) => c.ok)
  } catch (e) {
    res.ok = false
    res.error = e instanceof SmokeBudgetError ? { kind: 'budget', message: e.message }
      : signal?.aborted ? { kind: 'deadline', message: `stopped at the deadline: ${e instanceof Error ? e.message : String(e)}` }
      // A refused layout is the finding this check exists for: kept verbatim.
      : e instanceof Anthropic.BadRequestError ? { kind: 'refused', message: e.message, status: e.status }
      : { kind: 'other', message: e instanceof Error ? e.message : String(e), status: e instanceof Anthropic.APIError ? e.status : undefined }
  }
  for (const c of res.checks) log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.check}\n      ${c.detail}`)
  if (res.error) log(`STOPPED (${res.error.kind}): ${res.error.message}`)
  log(`spent $${res.spentUsd.toFixed(4)} of the $${ceilingUsd.toFixed(2)} ceiling`)
  return res
}
