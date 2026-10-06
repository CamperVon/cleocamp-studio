import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failureText, issuesFrom } from '../lib/mouse/issues'

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
