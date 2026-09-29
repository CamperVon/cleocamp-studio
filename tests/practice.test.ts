import { test } from 'node:test'
import assert from 'node:assert/strict'
import { practiceStop, PRACTICE_TOOLS } from '../lib/mouse/agent'
import { TOOLS } from '../lib/mouse/tools'
import { classifyResult } from '../lib/mouse/outcomes'

test('in practice, anything that changes something is stopped and never counts as done', () => {
  const r = practiceStop(true, 'create_todo', { title: 'Order more Boy Belts in Small' })
  assert.ok(r)
  assert.deepEqual(r.wouldHave, { tool: 'create_todo', input: { title: 'Order more Boy Belts in Small' } })
  assert.deepEqual(classifyResult('create_todo', r), { status: 'no_change', isWrite: false })
  for (const name of ['log_inventory_event', 'send_email', 'invoice_live_sale', 'cancel_live_sale', 'correct_inventory_event', 'add_note']) {
    assert.ok(practiceStop(true, name, {}), `${name} must be stopped in practice`)
  }
})

test('look-ups still run in practice, and nothing is stopped outside it', () => {
  assert.equal(practiceStop(true, 'query_status', { what: 'events' }), null)
  assert.equal(practiceStop(false, 'create_todo', {}), null)
  for (const name of PRACTICE_TOOLS) assert.ok(name === 'request_deep_analysis' || name in TOOLS, `${name} is a real tool`)
})
