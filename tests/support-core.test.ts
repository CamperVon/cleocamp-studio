import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  customerAddress, finalUrgency, isSupportMail, normalizeSubject, orderNumbersIn, parseVerdict, stripGroupFooter, unansweredCount,
} from '../lib/support/core'

test('support mail is told apart from Mouse’s own inbox', () => {
  assert.equal(isSupportMail('support@send.cleocamp.com'), true)
  assert.equal(isSupportMail('Support <support@send.cleocamp.com>'), true)
  assert.equal(isSupportMail('mouse@send.cleocamp.com'), false)
  assert.equal(isSupportMail('mouse@send.cleocamp.com, support@send.cleocamp.com'), true)
})

test('Google’s group footer is removed, the customer’s words kept', () => {
  // Exactly what the 23 Sept test arrived as.
  const got = stripGroupFooter('test\n\nTo unsubscribe from this group and stop receiving emails from it, send an email to support+unsubscribe@cleocamp.com.\n')
  assert.equal(got, 'test')
})

test('the real sender, including when Google rewrites From for DMARC', () => {
  assert.deepEqual(customerAddress('bc@thecampbrand.com'), { email: 'bc@thecampbrand.com', name: null })
  assert.deepEqual(customerAddress('Ana Ruiz <Ana@Example.com>'), { email: 'ana@example.com', name: 'Ana Ruiz' })
  assert.deepEqual(
    customerAddress("'Ana Ruiz' via Support <support@cleocamp.com>", 'ana@yahoo.com'),
    { email: 'ana@yahoo.com', name: 'Ana Ruiz' },
  )
})

test('replies and forwards thread onto the same subject', () => {
  assert.equal(normalizeSubject('Re: Fwd: RE: Wrong size'), 'wrong size')
  assert.equal(normalizeSubject('Wrong  size'), 'wrong size')
})

test('order numbers as customers write them, and not sizes or prices', () => {
  assert.deepEqual(orderNumbersIn('Hi, order #1042 came in the wrong size'), ['#1042'])
  assert.deepEqual(orderNumbersIn('my order number is 1043'), ['#1043'])
  assert.deepEqual(orderNumbersIn('size 2, paid $88'), [])
})

test('the model’s verdict is checked, with a safe fallback', () => {
  assert.deepEqual(
    parseVerdict('{"category":"WRONG_ITEM","urgency":"TODAY","summary":"Got a Medium, ordered Small.","customerName":"Ana"}'),
    { category: 'WRONG_ITEM', urgency: 'TODAY', summary: 'Got a Medium, ordered Small.', customerName: 'Ana' },
  )
  assert.deepEqual(parseVerdict('not json'), { category: 'OTHER', urgency: 'TODAY', summary: null, customerName: null })
  assert.equal(parseVerdict('{"category":"REFUND_NOW","urgency":"ASAP"}').category, 'OTHER')
})

const v = (category: string, urgency = 'DIGEST') => parseVerdict(JSON.stringify({ category, urgency }))

test('fires are decided in code, whatever the model said', () => {
  assert.equal(finalUrgency({ verdict: v('OTHER'), text: 'I will file a chargeback', inboundCount: 1 }), 'NOW')
  assert.equal(finalUrgency({ verdict: v('WHOLESALE'), text: 'stockist enquiry', inboundCount: 1 }), 'NOW')
  assert.equal(finalUrgency({ verdict: v('SIZING_QUESTION'), text: 'hello?', inboundCount: 3 }), 'NOW')
  assert.equal(finalUrgency({ verdict: v('WRONG_ITEM'), text: 'wrong size', inboundCount: 1 }), 'TODAY')
  assert.equal(
    finalUrgency({ verdict: v('WHERE_IS_MY_ORDER', 'TODAY'), text: 'where is it', inboundCount: 1, orderCreatedAt: '2026-09-01', now: new Date('2026-09-23') }),
    'NOW',
  )
  assert.equal(
    finalUrgency({ verdict: v('WHERE_IS_MY_ORDER', 'TODAY'), text: 'where is it', inboundCount: 1, orderCreatedAt: '2026-09-20', now: new Date('2026-09-23') }),
    'TODAY',
  )
  // Spam is never a fire, even if it shouts.
  assert.equal(finalUrgency({ verdict: v('SPAM', 'NOW'), text: 'LEGAL ACTION fraud', inboundCount: 5 }), 'DIGEST')
})

test('a forward from the team belongs to the customer inside it', async () => {
  const { forwardedOrigin } = await import('../lib/support/core')
  const gmail = `FYI\n\n---------- Forwarded message ---------\nFrom: Kay O'Connell <oconnell.kay@gmail.com>\nDate: Tue, Sep 15, 2026 at 2:06 PM\nSubject: Re: exchange\nTo: Cleo Camp <studio@cleocamp.com>\n\n\nHi!\n\nCan I put the white and pink tees in the mail as soon as I get back?\n\nKay`
  const o = forwardedOrigin(gmail)
  assert.equal(o?.email, 'oconnell.kay@gmail.com')
  assert.equal(o?.name, "Kay O'Connell")
  assert.equal(o?.subject, 'Re: exchange')
  assert.match(o!.body, /^Hi!/)
  const apple = `Begin forwarded message:\n\nFrom: nhhwang@gmail.com\nSubject: Return request for order #2076\nDate: September 16, 2026\n\nWould you please process a refund?`
  assert.equal(forwardedOrigin(apple)?.email, 'nhhwang@gmail.com')
  assert.equal(forwardedOrigin('Just a note from Cleo, no forward here.'), null)
})

test('the third-email alert counts only what is unanswered (Leah, 25 Sept)', () => {
  const m = (direction: string, fromAddress: string | null) => ({ direction, fromAddress })
  // Wrote, auto-reply, Brandon answered, then two more: this new one is the 2nd unanswered.
  assert.equal(unansweredCount([m('INBOUND', 'leah'), m('OUTBOUND', 'Auto-reply'), m('OUTBOUND', 'Brandon'), m('INBOUND', 'leah')]), 2)
  // The auto-reply is not an answer: three unanswered in a row still counts as three.
  assert.equal(unansweredCount([m('INBOUND', 'x'), m('OUTBOUND', 'Auto-reply'), m('INBOUND', 'x')]), 3)
  assert.equal(unansweredCount([]), 1)
})
