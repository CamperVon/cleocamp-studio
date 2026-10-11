import assert from 'node:assert/strict'
import test from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { runLoop } from '../lib/mouse/runner'
import { readLaneTurn, type AgentResult } from '../lib/mouse/agent'
import {
  chainKey, diagnosisOf, lastResponseIdFrom, prefixAttribution, prefixHashes, runsOf,
  type CacheDiagnosis, type ChainScope, type PrefixHashes,
} from '../lib/mouse/cache-diagnostics'

// Cache diagnostics (11 Oct 2026, MOUSE_CACHE_DIAGNOSTICS): diagnostics only,
// interactive chat only. These hold that the request changes by the
// `diagnostics` field alone; that a request is compared only within its own
// chain (thread, source, model, lane, effort); that the report pins a change
// on the exact response compared with; and that what is kept is ids,
// reasons, counts and hashes, never prompt text.

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 90000 } as Anthropic.Usage
const toolUse: Anthropic.ToolUseBlock = { type: 'tool_use', caller: { type: 'direct' }, name: 'query_status', id: 't1', input: {} }
const defs: Anthropic.Tool[] = [{ name: 'query_status', input_schema: { type: 'object' } }]
const base = { system: [{ type: 'text' as const, text: 'Rules.' }], messages: [{ role: 'user' as const, content: 'POs 2391 and 2394 have been received.' }], tools: defs, model: 'opus' }
const done = (id: string, diagnostics: unknown = null) => ({ id, content: [{ type: 'text' as const, text: 'Done.', citations: null }], stop_reason: 'end_turn' as const, usage, diagnostics: diagnostics as never })
const scopeA: ChainScope = { threadId: 'thread_A', source: 'chat', model: 'opus', lane: 'full' }
const scopeB: ChainScope = { ...scopeA, threadId: 'thread_B' }

test('off: the request carries no diagnostics field and nothing is recorded', async () => {
  const seen: Record<string, unknown>[] = []
  const r = await runLoop({ ...base, execute: async () => ({}),
    create: async (req) => { seen.push(req as never); return done('msg_1') },
  })
  assert.ok(!('diagnostics' in seen[0]))
  assert.equal(r.usage.requests[0].cacheDiagnosis, undefined)
  assert.equal(r.usage.requests[0].effort, 'medium', 'effort is recorded either way')
})

test('on: each request names the one before it in its chain, and the chain carries on to the next loop', async () => {
  const seen: Array<{ diagnostics?: unknown; [k: string]: unknown }> = []
  const high = chainKey(scopeA, 'high')
  const chains = { scope: scopeA, last: { [high]: 'msg_lastTurn' } as Record<string, string | null> }
  let n = 0
  const create = async (req: unknown) => {
    seen.push(req as never)
    n++
    if (n === 1) return { id: 'msg_a', content: [toolUse], stop_reason: 'tool_use' as const, usage,
      diagnostics: { cache_miss_reason: { type: 'tools_changed', cache_missed_input_tokens: 88000 } } }
    return done(`msg_${n}`)
  }
  const r = await runLoop({ ...base, execute: async () => ({}), create, effort: 'high', cacheDiagnostics: chains })
  assert.deepEqual(seen[0].diagnostics, { previous_message_id: 'msg_lastTurn' })
  assert.deepEqual(seen[1].diagnostics, { previous_message_id: 'msg_a' })
  assert.deepEqual(r.usage.requests.map((q) => q.cacheDiagnosis), [
    { chain: high, responseId: 'msg_a', previousId: 'msg_lastTurn', result: 'tools_changed', missedTokens: 88000 },
    { chain: high, responseId: 'msg_2', previousId: 'msg_a', result: 'no-divergence' },
  ])
  assert.equal(chains.last[high], 'msg_2', 'a second loop of the same run starts from here')

  // Everything else in the request is what it would have been with diagnostics off.
  const off: Record<string, unknown>[] = []
  n = 0
  await runLoop({ ...base, execute: async () => ({}), effort: 'high',
    create: async (req) => { off.push(req as never); return create(null) } })
  const strip = ({ diagnostics: _d, ...rest }: Record<string, unknown>) => { void _d; return JSON.stringify(rest) }
  assert.equal(strip(seen[0]), strip(off[0]))
})

test('high to low effort: the retry starts its own chain, and the high chain is left where it was', async () => {
  const high = chainKey(scopeA, 'high'), low = chainKey(scopeA, 'low')
  const chains = { scope: scopeA, last: { [high]: 'msg_prevHigh' } as Record<string, string | null> }
  const seen: Array<{ diagnostics?: unknown }> = []
  let n = 0
  const r = await runLoop({ ...base, execute: async () => ({}), effort: 'high', cacheDiagnostics: chains,
    create: async (req) => {
      seen.push(req as never)
      return n++ === 0
        ? { id: 'msg_x', content: [{ type: 'thinking', thinking: '', signature: '' }] as never, stop_reason: 'max_tokens' as const, usage }
        : done('msg_y', { cache_miss_reason: null })
    },
  })
  assert.deepEqual(seen.map((s) => s.diagnostics), [{ previous_message_id: 'msg_prevHigh' }, { previous_message_id: null }],
    'the low-effort request is not compared with the high-effort one before it')
  assert.deepEqual(r.usage.requests.map((q) => [q.effort, q.cacheDiagnosis?.chain, q.cacheDiagnosis?.result]),
    [['high', high, 'no-divergence'], ['low', low, 'not-compared']])
  assert.deepEqual(chains.last, { [high]: 'msg_x', [low]: 'msg_y' })
})

test('diagnosisOf reads every shape Anthropic sends', () => {
  assert.equal(diagnosisOf('c', 'm', null, null).result, 'not-compared')
  assert.equal(diagnosisOf('c', 'm', 'p', null).result, 'no-divergence')
  assert.equal(diagnosisOf('c', 'm', 'p', undefined).result, 'no-divergence')
  assert.equal(diagnosisOf('c', 'm', 'p', { cache_miss_reason: null }).result, 'pending')
  assert.deepEqual(diagnosisOf('c', 'm', 'p', { cache_miss_reason: { type: 'previous_message_not_found' } }),
    { chain: 'c', responseId: 'm', previousId: 'p', result: 'previous_message_not_found' })
  assert.equal(diagnosisOf('c', 'm', 'p', { cache_miss_reason: { type: 'system_changed', cache_missed_input_tokens: 12 } }).missedTokens, 12)
})

test('the chain key holds thread, source, model, lane and effort apart', () => {
  const keys = new Set([
    chainKey(scopeA, 'high'), chainKey(scopeB, 'high'), chainKey({ ...scopeA, source: 'say' }, 'high'),
    chainKey({ ...scopeA, model: 'sonnet' }, 'high'), chainKey({ ...scopeA, lane: 'read' }, 'high'), chainKey(scopeA, 'low'),
  ])
  assert.equal(keys.size, 6)
})

const req = (chain: string, responseId: string) => ({ cacheDiagnosis: { chain, responseId } })

test('interleaved threads: the previous response is the newest on the same chain, never another thread', () => {
  const a = chainKey(scopeA, 'high'), b = chainKey(scopeB, 'high')
  const read = chainKey({ ...scopeA, model: 'sonnet', lane: 'read' }, 'medium')
  // Newest first, threads interleaved as the replies were saved.
  const usages = [
    { requests: [req(b, 'b2')] },
    { requests: [req(a, 'a3'), req(a, 'a4')], route: { attempt: { requests: [req(read, 'r1')] } } },
    { requests: [req(b, 'b1')] },
    { requests: [req(a, 'a1'), req(a, 'a2')] },
    { requests: [{}] }, // a reply from before diagnostics was on
    null,
  ]
  assert.equal(lastResponseIdFrom(usages, a), 'a4')
  assert.equal(lastResponseIdFrom(usages, b), 'b2')
  assert.equal(lastResponseIdFrom(usages, read), 'r1', 'read-lane attempts are found on their own chain')
  assert.equal(lastResponseIdFrom(usages, chainKey(scopeA, 'low')), null)
  assert.equal(lastResponseIdFrom([], a), null)
})

const hashes = (live: string, tools = 'T'): PrefixHashes => prefixHashes({ tools: [tools], rules: 'R', stable: 'S', live })
const run = (prefix: PrefixHashes | undefined, ...ds: Array<Partial<CacheDiagnosis> & { responseId: string }>) =>
  ({ prefix, requests: ds.map((d) => ({ cacheDiagnosis: { chain: 'c', previousId: null, result: 'not-compared', ...d } })) })

test('exact previousId attribution: a change is pinned on the response compared with, not the row before', () => {
  const runs = [
    run(hashes('L1'), { responseId: 'a1' }),                                                      // thread A, turn 1
    run(hashes('L2', 'T-other'), { responseId: 'b1' }),                                           // thread B in between
    run(hashes('L1'), { responseId: 'a2', previousId: 'a1', result: 'no-divergence' }),           // thread A, turn 2
    run(hashes('L3'), { responseId: 'a3', previousId: 'a2', result: 'system_changed' }, { responseId: 'a4', previousId: 'a3' }),
    run(hashes('L3'), { responseId: 'z1', previousId: 'gone', result: 'previous_message_not_found' }),
  ]
  assert.deepEqual(prefixAttribution(runs), [
    { responseId: 'a2', previousId: 'a1', result: 'no-divergence', moved: [] }, // the row before (b1) differs in tools and live; a1 does not
    { responseId: 'a3', previousId: 'a2', result: 'system_changed', moved: ['live'] },
    { responseId: 'z1', previousId: 'gone', result: 'previous_message_not_found', moved: 'unlinked' },
  ])
})

test('a read-lane attempt keeps its prefix hashes, so its requests can be attributed', async () => {
  const p = hashes('L1')
  const result = (text: string, prefix?: PrefixHashes, ids: string[] = []): AgentResult => ({
    text, writes: [], toolCalls: [], model: prefix ? 'sonnet' : 'opus', prefetched: false,
    usage: { requests: ids.map((id) => ({ model: 'x', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, durationMs: 0,
      cacheDiagnosis: { chain: 'c', responseId: id, previousId: null, result: 'not-compared' } })), attemptedRequests: ids.length, providerError: null, durationMs: 0, stopReason: 'complete', ...(prefix ? { prefix } : {}) },
  } as unknown as AgentResult)
  // An answer that says it can't, so the read lane hands over to Opus.
  const r = await readLaneTurn('read-eligible', async () => result("I can't see that from here.", p, ['r1']), async () => result('Opus answer.', hashes('L2'), ['o1']))
  assert.equal(r.usage.route?.escalated, true)
  assert.deepEqual(r.usage.route?.attempt?.prefix, p)
  const runs = runsOf(r.usage as never)
  assert.deepEqual(runs.map((x) => x.prefix), [p, hashes('L2')])
})

test('prefix hashes are short hashes, never the text, and move only with their block', () => {
  const p = { tools: defs, rules: 'SECRET RULE TEXT', stable: 'Vendors: Antonio', live: 'Open POs: 2391' }
  const a = prefixHashes(p)
  const b = prefixHashes({ ...p, live: 'Open POs: 2394' })
  for (const v of Object.values(a)) assert.ok(v === null || /^[0-9a-f]{12}$/.test(v))
  assert.ok(!JSON.stringify(a).includes('SECRET') && !JSON.stringify(a).includes('Antonio'))
  assert.equal(a.tools, b.tools); assert.equal(a.rules, b.rules); assert.equal(a.stable, b.stable)
  assert.notEqual(a.live, b.live)
  assert.equal(a.extraRules, null)
})
