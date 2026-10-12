import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emailProblem, planEmailChange } from '../lib/shopify-email'
import { NOT_FROM_EMAIL } from '../lib/mouse/team-mail'
import { PROPOSAL_TOOLS, toolsFor } from '../lib/mouse/agent'
import { TOOL_KINDS } from '../lib/mouse/tool-kinds'

// set_order_email (12 Oct 2026): Cleo could not get Ella Snyder's email onto
// gift order #2794. Brandon: allowed from email "as long as its from us".

test('the email is checked before anything is sent to Shopify', () => {
  assert.equal(emailProblem('ellasnyder100@gmail.com'), null)
  assert.equal(emailProblem(' ella@studio.co.uk '), null)
  for (const bad of ['', 'ella', 'ella@gmail', 'ella snyder@gmail.com', '<ella@gmail.com>', 'a@b.com, c@d.com']) assert.ok(emailProblem(bad), bad)
})

test('the order gets the email; a blank customer gets it; an existing customer email is never replaced', () => {
  const e = 'ellasnyder100@gmail.com'
  assert.deepEqual(planEmailChange({ orderEmail: null, customerId: 'c1', customerEmail: null }, e), { setOrder: true, setCustomer: true, customerKeeps: null })
  assert.deepEqual(planEmailChange({ orderEmail: 'old@x.com', customerId: 'c1', customerEmail: 'old@x.com' }, e), { setOrder: true, setCustomer: false, customerKeeps: 'old@x.com' })
  assert.deepEqual(planEmailChange({ orderEmail: 'EllaSnyder100@gmail.com', customerId: 'c1', customerEmail: e }, e), { setOrder: false, setCustomer: false, customerKeeps: null })
  assert.deepEqual(planEmailChange({ orderEmail: null, customerId: null, customerEmail: null }, e), { setOrder: true, setCustomer: false, customerKeeps: null })
})

test('from a verified team email yes, from anyone else\'s mail never, and it counts as a change', () => {
  assert.equal(TOOL_KINDS.set_order_email, 'changes')
  assert.ok(!NOT_FROM_EMAIL.has('set_order_email'), 'a verified team email may use it')
  assert.ok(!PROPOSAL_TOOLS.includes('set_order_email'), 'untrusted mail only proposes')
  assert.ok(!toolsFor(undefined, 'thread_1', 'read').includes('set_order_email'), 'not in the read lane')
})
