import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addressedToMouse, dmarcFromHeaders, NOT_FROM_EMAIL } from '../lib/mouse/team-mail'

test('only mail sent TO Mouse counts, not mail that copies it', () => {
  assert.equal(addressedToMouse('mouse@send.cleocamp.com'), true)
  assert.equal(addressedToMouse('Studio Mouse <mouse@send.cleocamp.com>, jane@cleocamp.com'), true)
  assert.equal(addressedToMouse('antonio@empire.com'), false)
  assert.equal(addressedToMouse('notmouse@send.cleocamp.com'), false)
})

test("DMARC is read from the receiving server's top header, folded lines and all", () => {
  const real = 'Received: from x\r\nAuthentication-Results: mx.resend;\r\n spf=pass;\r\n dkim=pass header.i=@cleocamp.com;\r\n dmarc=pass header.from=cleocamp.com;\r\nFrom: brandon@cleocamp.com\r\n\r\nbody dmarc=pass'
  assert.equal(dmarcFromHeaders(real), 'pass')
  // A forger can add their own header lower down; the receiver's is on top.
  const forged = 'Authentication-Results: mx.resend; spf=fail; dmarc=fail header.from=cleocamp.com\nAuthentication-Results: fake; dmarc=pass\nFrom: brandon@cleocamp.com\n\nhi'
  assert.equal(dmarcFromHeaders(forged), 'fail')
  assert.equal(dmarcFromHeaders('From: a@b.com\n\nbody'), 'unknown')
})

test('nothing that sends or moves money runs from an email', () => {
  for (const t of ['send_email', 'send_purchase_order', 'invoice_live_sale', 'refund_friends_family', 'update_person_email']) assert.ok(NOT_FROM_EMAIL.has(t), t)
})

test('a gift can be made from verified team email; money and sending still cannot', () => {
  assert.equal(NOT_FROM_EMAIL.has('gift_items'), false)
  for (const t of ['invoice_live_sale', 'refund_friends_family', 'send_purchase_order', 'send_email', 'cancel_live_sale']) assert.ok(NOT_FROM_EMAIL.has(t), t)
})
