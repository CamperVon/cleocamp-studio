import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failureText, issuesFrom, repeatUpdate } from '../lib/mouse/issues'

test('failed and refused calls and an unfinished turn become log entries', () => {
  const out = issuesFrom({
    stopReason: 'budget',
    toolCalls: [
      { name: 'query_status', status: 'succeeded' },
      { name: 'record_stock', status: 'failed', error: 'Inventory writing is paused.', input: { qty: 3 } },
      { name: 'send_po', status: 'failed', result: { ok: false, reason: 'No email on file for the vendor.' } },
    ],
  })
  assert.deepEqual(out.map((o) => [o.kind, o.tool ?? null, o.detail]), [
    ['TOOL_FAILED', 'record_stock', 'Inventory writing is paused.'],
    ['TOOL_FAILED', 'send_po', 'No email on file for the vendor.'],
    ['TURN_UNFINISHED', null, 'The run stopped before finishing (budget).'],
  ])
})

test('a refusal with no words falls back to the result itself', () => {
  assert.equal(failureText({ result: { applied: false } }), '{"applied":false}')
  assert.deepEqual(issuesFrom({ stopReason: 'complete', toolCalls: [] }), [])
})

test('running out of Anthropic credit is logged as that, plainly', async () => {
  const { isOutOfCredit, OUT_OF_CREDIT_LOG } = await import('../lib/mouse/credit-text')
  const err = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
  assert.equal(isOutOfCredit(err), true)
  assert.equal(isOutOfCredit('529 overloaded'), false)
  assert.deepEqual(issuesFrom({ stopReason: 'provider_error', providerError: err, toolCalls: [] }).map((o) => o.detail), [OUT_OF_CREDIT_LOG])
  assert.deepEqual(issuesFrom({ stopReason: 'provider_error', providerError: '529 overloaded', toolCalls: [] }).map((o) => o.detail), ['The run stopped before finishing (provider_error).'])
})

test('a repeat shows its latest question, door and input, not the first one', () => {
  const now = new Date('2026-11-25T14:52:07Z')
  const d = { kind: 'TURN_UNFINISHED' as const, detail: 'The run stopped before finishing (budget).' }
  const u = repeatUpdate('chat', 'actually i found it, order #3100', d, now)
  assert.deepEqual(u, { times: { increment: 1 }, lastSeenAt: now, source: 'chat', asked: 'actually i found it, order #3100' })
  // No question to hand (a nightly pass): keep the one on file rather than blank it.
  assert.equal('asked' in repeatUpdate('nightly-pass', null, d, now), false)
  // A failed tool's input is the latest one's.
  const t = repeatUpdate('chat', 'log it', { kind: 'TOOL_FAILED', tool: 'x', detail: 'no', input: { qty: 3 } }, now)
  assert.deepEqual(t.input, { qty: 3 })
  assert.equal(repeatUpdate('chat', 'x'.repeat(600), d, now).asked?.length, 500)
})
