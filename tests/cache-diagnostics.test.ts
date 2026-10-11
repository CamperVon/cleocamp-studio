import assert from 'node:assert/strict'
import test from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { runLoop } from '../lib/mouse/runner'
import { diagnosisOf, lastResponseIdFrom, prefixHashes } from '../lib/mouse/cache-diagnostics'

// Cache diagnostics (11 Oct 2026, MOUSE_CACHE_DIAGNOSTICS): diagnostics only.
// These hold that the request changes by the `diagnostics` field alone, that
// the id is threaded request to request and loop to loop, and that what is
// kept is ids, reasons, counts and hashes, never prompt text.

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 90000 } as Anthropic.Usage
const toolUse: Anthropic.ToolUseBlock = { type: 'tool_use', caller: { type: 'direct' }, name: 'query_status', id: 't1', input: {} }
const defs: Anthropic.Tool[] = [{ name: 'query_status', input_schema: { type: 'object' } }]
const base = { system: [{ type: 'text' as const, text: 'Rules.' }], messages: [{ role: 'user' as const, content: 'POs 2391 and 2394 have been received.' }], tools: defs, model: 'opus' }

test('off: the request carries no diagnostics field and nothing is recorded', async () => {
  const seen: Record<string, unknown>[] = []
  const r = await runLoop({ ...base, execute: async () => ({}),
    create: async (req) => { seen.push(req as never); return { id: 'msg_1', content: [{ type: 'text', text: 'Done.', citations: null }], stop_reason: 'end_turn', usage } },
  })
  assert.ok(!('diagnostics' in seen[0]))
  assert.equal(r.usage.requests[0].cacheDiagnosis, undefined)
  assert.equal(r.usage.requests[0].lane, undefined)
  assert.equal(r.usage.requests[0].effort, 'medium', 'effort is recorded either way')
})

test('on: each request names the one before it, and the thread carries on to the next loop', async () => {
  const seen: Array<{ diagnostics?: unknown; [k: string]: unknown }> = []
  const thread = { previousId: 'msg_lastTurn' as string | null }
  let n = 0
  const create = async (req: unknown) => {
    seen.push(req as never)
    n++
    if (n === 1) return { id: 'msg_a', content: [toolUse], stop_reason: 'tool_use' as const, usage,
      diagnostics: { cache_miss_reason: { type: 'tools_changed', cache_missed_input_tokens: 88000 } } }
    return { id: `msg_${n}`, content: [{ type: 'text' as const, text: 'Done.', citations: null }], stop_reason: 'end_turn' as const, usage, diagnostics: null }
  }
  const r = await runLoop({ ...base, execute: async () => ({}), create, effort: 'high', cacheDiagnostics: { thread, lane: 'full' } })
  assert.deepEqual(seen[0].diagnostics, { previous_message_id: 'msg_lastTurn' })
  assert.deepEqual(seen[1].diagnostics, { previous_message_id: 'msg_a' })
  assert.deepEqual(r.usage.requests.map((q) => q.cacheDiagnosis), [
    { responseId: 'msg_a', previousId: 'msg_lastTurn', result: 'tools_changed', missedTokens: 88000 },
    { responseId: 'msg_2', previousId: 'msg_a', result: 'no-divergence' },
  ])
  assert.deepEqual(r.usage.requests.map((q) => [q.lane, q.effort]), [['full', 'high'], ['full', 'high']])
  assert.equal(thread.previousId, 'msg_2', 'a second loop of the same run starts from here')

  // Everything else in the request is what it would have been with diagnostics off.
  const off: Record<string, unknown>[] = []
  n = 0
  await runLoop({ ...base, execute: async () => ({}), effort: 'high',
    create: async (req) => { off.push(req as never); return create(null as never) } })
  const strip = ({ diagnostics: _d, ...rest }: Record<string, unknown>) => { void _d; return JSON.stringify(rest) }
  assert.equal(strip(seen[0]), strip(off[0]))
})

test('the overthinking retry records the lower effort on its own request', async () => {
  let n = 0
  const r = await runLoop({ ...base, execute: async () => ({}), effort: 'high', cacheDiagnostics: { thread: { previousId: null }, lane: 'full' },
    create: async () => (n++ === 0
      ? { id: 'msg_x', content: [{ type: 'thinking', thinking: '', signature: '' }] as never, stop_reason: 'max_tokens' as const, usage }
      : { id: 'msg_y', content: [{ type: 'text' as const, text: 'Done.', citations: null }], stop_reason: 'end_turn' as const, usage, diagnostics: { cache_miss_reason: null } }),
  })
  assert.deepEqual(r.usage.requests.map((q) => q.effort), ['high', 'low'])
  assert.deepEqual(r.usage.requests.map((q) => q.cacheDiagnosis?.result), ['not-compared', 'pending'])
})

test('diagnosisOf reads every shape Anthropic sends', () => {
  assert.equal(diagnosisOf('m', null, null).result, 'not-compared')
  assert.equal(diagnosisOf('m', 'p', null).result, 'no-divergence')
  assert.equal(diagnosisOf('m', 'p', undefined).result, 'no-divergence')
  assert.equal(diagnosisOf('m', 'p', { cache_miss_reason: null }).result, 'pending')
  assert.deepEqual(diagnosisOf('m', 'p', { cache_miss_reason: { type: 'previous_message_not_found' } }),
    { responseId: 'm', previousId: 'p', result: 'previous_message_not_found' })
  assert.equal(diagnosisOf('m', 'p', { cache_miss_reason: { type: 'system_changed', cache_missed_input_tokens: 12 } }).missedTokens, 12)
})

test('the previous response is the newest one on the same model and lane, read-lane attempts included', () => {
  const req = (model: string, id: string, lane?: string) => ({ model, lane, cacheDiagnosis: { responseId: id } })
  const usages = [
    { requests: [req('opus', 'o3'), req('opus', 'o4')], route: { attempt: { requests: [req('sonnet', 's2', 'read')] } } },
    { requests: [req('opus', 'o1'), req('opus', 'o2')] },
    { requests: [{ model: 'opus' }] }, // a reply from before diagnostics was on
    null,
  ]
  assert.equal(lastResponseIdFrom(usages, { model: 'opus', lane: 'full' }), 'o4')
  assert.equal(lastResponseIdFrom(usages, { model: 'sonnet', lane: 'read' }), 's2')
  assert.equal(lastResponseIdFrom(usages, { model: 'sonnet', lane: 'full' }), null)
  assert.equal(lastResponseIdFrom([], { model: 'opus', lane: 'full' }), null)
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
