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

test('the Pressing email is kept to follow-ups, changes before shipping and threats (26 Sept 2026)', () => {
  // A second email with no answer yet, on anything but spam.
  assert.equal(finalUrgency({ verdict: v('SIZING_QUESTION'), text: 'hello?', inboundCount: 2 }), 'NOW')
  assert.equal(finalUrgency({ verdict: v('SIZING_QUESTION'), text: 'hello?', inboundCount: 1 }), 'DIGEST')
  // A change to an unshipped order races the packing table.
  assert.equal(finalUrgency({ verdict: v('ORDER_CHANGE'), text: 'new address', inboundCount: 1, orderFulfilled: false }), 'NOW')
  assert.equal(finalUrgency({ verdict: v('ORDER_CHANGE'), text: 'new address', inboundCount: 1, orderFulfilled: true }), 'DIGEST')
  assert.equal(finalUrgency({ verdict: v('OTHER'), text: 'I will file a chargeback', inboundCount: 1 }), 'NOW')
  // No longer an email: the model's own NOW, wholesale, press, wrong item, old orders.
  assert.equal(finalUrgency({ verdict: v('OTHER', 'NOW'), text: 'URGENT!!', inboundCount: 1 }), 'TODAY')
  assert.equal(finalUrgency({ verdict: v('WHOLESALE'), text: 'stockist enquiry', inboundCount: 1 }), 'TODAY')
  assert.equal(finalUrgency({ verdict: v('WRONG_ITEM'), text: 'wrong size', inboundCount: 1 }), 'TODAY')
  assert.equal(
    finalUrgency({ verdict: v('WHERE_IS_MY_ORDER', 'TODAY'), text: 'where is it', inboundCount: 1, orderCreatedAt: '2026-09-01', now: new Date('2026-09-23') }),
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

test('quoted history is cut from customer messages', async () => {
  const { trimQuoted } = await import('../lib/support/core')
  const mack = "Hi there, my order is taking much longer than originally expected, and I\nwould like to cancel it before the item ships.\n\nThank you!\n\nMacKenzie\n\nOn Sun, Sep 20, 2026 at 2:08 PM cleocamp <\nstore+79155396861@m.shopifyemail.com> wrote:\n\n> We appreciate your business\n>\n> unsubscribe <https://cleocamp.com/...>"
  const r = trimQuoted(mack)
  assert.equal(r.trimmed, true)
  assert.match(r.text, /cancel it before the item ships/)
  assert.match(r.text, /MacKenzie$/)
  assert.doesNotMatch(r.text, /appreciate your business|wrote:/)

  const outlook = "Yes please, the white one.\n\nBest,\nAna\n\n________________________________\nFrom: Cleo Studio <support@cleocamp.com>\nSent: Monday\nSubject: Re: order"
  assert.equal(trimQuoted(outlook).text, 'Yes please, the white one.\n\nBest,\nAna')

  const plain = 'Where is my order #2555? It has been two weeks.'
  assert.deepEqual(trimQuoted(plain), { text: plain, trimmed: false })

  // Nothing but a quote: keep it all rather than show an empty message.
  const onlyQuote = '\nOn Mon, Sep 1, 2026 at 9:00 AM Cleo wrote:\n> hello\n> there'
  assert.equal(trimQuoted(onlyQuote).trimmed, false)
})

test('a forward of the team\'s own reply names the customer it went to (Abby)', async () => {
  const { forwardedOrigin } = await import('../lib/support/core')
  const fwd = `---------- Forwarded message ---------\nFrom: Cleo Camp <studio@cleocamp.com>\nDate: Fri, Sep 25, 2026 at 3:32 PM\nSubject: Re: Cleo Top\nTo: Abby p <abbypayneee@gmail.com>\n\n\nOh my god Abby I'm sorry this email sat here for so long.\n\nXO\nCleo\n\nOn Fri, Aug 7, 2026 at 2:24 PM Abby p <abbypayneee@gmail.com> wrote:\n\n> Hello!`
  const o = forwardedOrigin(fwd)
  assert.equal(o?.email, 'studio@cleocamp.com')
  assert.equal(o?.to, 'abbypayneee@gmail.com')
  assert.equal(o?.toName, 'Abby p')
  // The "wrote:" line further down is not the header's To.
  const noTo = `---------- Forwarded message ---------\nFrom: Kay <kay@gmail.com>\nSubject: hi\n\nTo: whom it may concern, x@y.com`
  assert.equal(forwardedOrigin(noTo)?.to, null)
})

test('a customer writing from another address is matched by name, never by number alone', async () => {
  const { namesMatch } = await import('../lib/support/core')
  // Serena: first name.
  assert.equal(namesMatch('Serena', 'js12847@nyu.edu', ['Serena Song', null]), true)
  // Corinne from work and from the family address: surname in the address.
  assert.equal(namesMatch('Corinne', 'corinnelammers@paulhastings.com', ['Cori Lammers']), true)
  assert.equal(namesMatch(null, 'eandclammers@msn.com', ['Cori Lammers']), true)
  // Someone else quoting the number.
  assert.equal(namesMatch('Dana', 'dana@x.com', ['Serena Song', 'Serena Song']), false)
  assert.equal(namesMatch(null, 'js12847@nyu.edu', ['Serena Song']), false)
  // A short surname is too easy to hit by accident.
  assert.equal(namesMatch(null, 'bookworm@x.com', ['Amy Ko']), false)
})

test('a thank-you after our reply is told apart from a follow-up (25 Sept 2026, real replies)', async () => {
  const { isJustThanks } = await import('../lib/support/core')
  const thanks = [
    "Thank you!\n\nOn Fri, Sep 25, 2026 at 7:10 PM Cleo Studio <support@send.cleocamp.com>\nwrote:\n\n> Hi MacKenzie,\n>\n> We've gone ahead and cancelled order #2555.\n> It's been refunded",
    "Oh! No worries. That’s kind of what I thought, I was just thrown because Shopify said it was supposed to be delivered last week! Sorry if I was being pushy! Thank you!",
    'Thank you so much for your response. I appreciate the update and I look forward to receiving my top sometime in October (they are fabulous tops!).\n\nBest,\nDeirdre',
    'Hi, thanks for the update and for the discount code! I appreciate you letting me know.',
    'Thank you for the update! No problem at all, just wanted to know the situation. :)\nRebecca',
  ]
  for (const t of thanks) assert.equal(isJustThanks(t), true, t.slice(0, 40))
  const notThanks = [
    'Does it have to be shipped back in the same box?',
    "Hi there, I didn't realize the black colorway was a pre-order, thanks for letting me know. Will the same tracking number work?",
    'Hello! I haven’t received shipping notification yet. Please let me know when this will ship. Thank you, Nikki',
    "Hello! Thank you so much for your reply. I'd like to return both for a refund, and then I'll reorder the one I want in my size.",
    "Hi! I'll forward it to you. It's a follow up from an IG chat. Thanks. Leah",
    'Thanks, but the tee arrived with a stain on the front.',
    'Hi, where is my order',
  ]
  for (const t of notThanks) assert.equal(isJustThanks(t), false, t.slice(0, 40))
})
