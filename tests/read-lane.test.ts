import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OPUS_ESCALATE, READ_LANE_TOOLS, readLaneGuard, readLaneTurn, toolsFor, whyOpus, type AgentResult } from '../lib/mouse/agent'
import { TOOLS } from '../lib/mouse/tools'

const usage = (stopReason: AgentResult['usage']['stopReason'] = 'complete', model = 'm') => ({
  requests: [{ model, inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, durationMs: 5 }],
  attemptedRequests: 1, providerError: null, durationMs: 5, stopReason,
})
const sonnet = (text: string, extra: Partial<AgentResult> = {}): AgentResult => ({ text, writes: [], toolCalls: [{ name: 'open_record', status: 'succeeded' }], model: 'claude-sonnet-5-5', usage: usage('complete', 'claude-sonnet-5-5'), ...extra })
const opusReply: AgentResult = { text: 'The Opus answer.', writes: [], toolCalls: [{ name: 'query_status', status: 'succeeded' }], model: 'claude-opus-5-5', usage: usage('complete', 'claude-opus-5-5') }

test('the read lane holds look-up tools only: no files, no notes, no writes', () => {
  assert.deepEqual([...READ_LANE_TOOLS].sort(), ['check_sent_mail', 'find_contacts', 'find_customer', 'find_in_shopify', 'open_record', 'query_status', 'reorder_math', 'search_chat', 'shopify_analytics', 'unpaid_live_sales'])
  for (const n of ['read_file', 'note_problem', 'keep_file', 'draft_order_links', 'add_note', 'log_inventory_event', 'send_email', 'create_todo', 'update_component']) assert.ok(!READ_LANE_TOOLS.has(n), n)
  for (const n of READ_LANE_TOOLS) assert.ok(TOOLS[n], `${n} exists`)
  // What the model is offered, even from a list or a default set that holds more.
  assert.deepEqual(toolsFor(undefined, 'thread_1', 'read').sort(), [...READ_LANE_TOOLS].sort())
  assert.deepEqual(toolsFor(['log_inventory_event', 'open_record', 'read_file'], 'thread_1', 'read'), ['open_record'])
  // Outside the read lane nothing changes.
  assert.ok(toolsFor(undefined, 'thread_1').includes('log_inventory_event'))
})

test('in the read lane any other tool throws before it runs', () => {
  for (const n of ['log_inventory_event', 'keep_file', 'read_file', 'send_email', 'add_note', 'create_todo']) {
    assert.throws(() => readLaneGuard('read', n), /not available in the read lane/, n)
  }
  assert.equal(readLaneGuard('read', 'open_record'), null)
  assert.equal(readLaneGuard(undefined, 'log_inventory_event'), null) // Opus turns: no change
})

test('when an attempt is handed to Opus', () => {
  assert.equal(whyOpus(sonnet(OPUS_ESCALATE)), 'asked-for-opus')
  assert.equal(whyOpus(sonnet(`Partly: two skirts. ${OPUS_ESCALATE}`)), 'asked-for-opus')
  assert.equal(whyOpus(sonnet('x', { usage: usage('refusal') })), 'stopped:refusal')
  assert.equal(whyOpus(sonnet('x', { usage: usage('provider_error') })), 'stopped:provider_error')
  assert.equal(whyOpus(sonnet('x', { toolCalls: [{ name: 'log_inventory_event', status: 'failed' }] })), 'tool-failed')
  assert.equal(whyOpus(sonnet('  ')), 'empty')
  assert.equal(whyOpus(sonnet('There are 11 skirts at the studio.')), null)
})

test('a handed-over attempt is never shown or saved: only the Opus answer, the attempt kept as cost', async () => {
  for (const attempt of [
    sonnet(`SONNET PARTIAL ANSWER ${OPUS_ESCALATE}`),
    sonnet('SONNET PARTIAL ANSWER', { usage: usage('refusal', 'claude-sonnet-5-5') }),
    sonnet('SONNET PARTIAL ANSWER', { toolCalls: [{ name: 'add_note', status: 'failed', result: { error: 'SONNET PARTIAL ANSWER' } }] }),
  ]) {
    const r = await readLaneTurn('read-eligible', async () => attempt, async () => opusReply)
    assert.equal(r.text, 'The Opus answer.')
    assert.equal(r.model, 'claude-opus-5-5')
    assert.deepEqual(r.toolCalls, opusReply.toolCalls)
    assert.deepEqual(r.usage.requests, opusReply.usage.requests) // the reply's own usage is Opus's
    assert.equal(r.usage.route?.escalated, true)
    assert.deepEqual(r.usage.route?.attempt?.requests, attempt.usage.requests) // the attempt's cost, kept
    assert.ok(!JSON.stringify(r).includes('SONNET PARTIAL ANSWER')) // and nothing it said or wrote
  }
})

test('an attempt that stands is the reply, and Opus is not called', async () => {
  let called = false
  const r = await readLaneTurn('read-eligible', async () => sonnet('There are 11 skirts at the studio.'), async () => { called = true; return opusReply })
  assert.equal(called, false)
  assert.equal(r.text, 'There are 11 skirts at the studio.')
  assert.deepEqual(r.usage.route, { lane: 'read', reason: 'read-eligible', model: 'claude-sonnet-5-5', effort: 'medium' })
})

test('the switch is off unless MOUSE_READ_LANE is exactly "1"', () => {
  const src = readFileSync(new URL('../lib/mouse/agent.ts', import.meta.url), 'utf8')
  assert.match(src, /enabled: process\.env\.MOUSE_READ_LANE === '1'/)
})
