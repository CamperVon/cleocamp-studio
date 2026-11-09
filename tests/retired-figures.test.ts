import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRetiredFiguresEmail } from '../lib/mouse/inbox'

test('the old QuickBooks figures emails are retired; Intuit notices are not', () => {
  assert.equal(isRetiredFiguresEmail({ fromAddress: 'quickbooks@send.cleocamp.com', subject: 'QuickBooks figures — 9 November 2026' }), true)
  assert.equal(isRetiredFiguresEmail({ fromAddress: 'quickbooks@send.cleocamp.com', subject: 'Processing payment to Staples' }), false)
  assert.equal(isRetiredFiguresEmail({ fromAddress: 'brandon@cleocamp.com', subject: 'QuickBooks figures' }), false)
})
