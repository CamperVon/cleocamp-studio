import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyResult } from '../lib/mouse/outcomes'

// 13 Oct 2026: invoice_wholesale and send_wholesale_draft return the draft's
// name ("#D57") while waiting for a yes, and every such draft was logged as a
// failed tool call and fed back to Mouse as an error.
test('a wholesale draft waiting for a yes is not a failure, named or not', () => {
  const ok = { status: 'no_change', isWrite: false }
  assert.deepEqual(classifyResult('invoice_wholesale', { sent: false, draft: '#D57', draftOrderId: 'gid://shopify/DraftOrder/1' }), ok)
  assert.deepEqual(classifyResult('send_wholesale_draft', { sent: false, draft: '#D53', to: 'Store <a@b.co>' }), ok)
  assert.deepEqual(classifyResult('send_email', { sent: false, draft: true }), ok)
})

test('a refusal is still a failure, even if it names a draft', () => {
  const failed = { status: 'failed', isWrite: false }
  assert.deepEqual(classifyResult('send_wholesale_draft', { sent: false, reason: 'No draft #D99 among the last 100 in Shopify.' }), failed)
  assert.deepEqual(classifyResult('send_wholesale_draft', { sent: false, draft: '#D53', reason: 'has no email on it' }), failed)
  assert.deepEqual(classifyResult('invoice_wholesale', { sent: false, draft: '' }), failed)
  assert.deepEqual(classifyResult('invoice_wholesale', { error: 'boom', draft: '#D1' }), failed)
})
