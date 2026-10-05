import { test } from 'node:test'
import assert from 'node:assert/strict'
import { campaignKey, renderNotice, waitingItems } from '../lib/waiting-notice'

const m = { product: 'Cleo Tee', colours: ['Black', 'White'] }

test('only unshipped pieces of the product, in the chosen colours, count', () => {
  const items = waitingItems([
    { title: 'Cleo Tee', variantTitle: 'Black / 1', unfulfilledQuantity: 1 },
    { title: 'Cleo Tee', variantTitle: 'White / 2', unfulfilledQuantity: 0 },   // already shipped
    { title: 'Cleo Tee - Splish', variantTitle: 'Splish / 1', unfulfilledQuantity: 1 }, // another listing
    { title: 'Cleo Tee', variantTitle: 'Shell / 1', unfulfilledQuantity: 1 },  // another colour
    { title: 'Cleo Tee', variantTitle: 'white / 3', unfulfilledQuantity: 2 },
  ], m)
  assert.deepEqual(items, ['Black Cleo Tee, size 1', '2 × white Cleo Tee, size 3'])
})

test('an order whose tee has shipped and something else is waiting is not included', () => {
  assert.deepEqual(waitingItems([
    { title: 'Cleo Tee - Shell', variantTitle: 'Shell / 1', unfulfilledQuantity: 1 },
    { title: 'Cleo Tee', variantTitle: 'Black / 1', unfulfilledQuantity: 0 },
  ], m), [])
})

test("Cleo's words go out as written, with only the placeholders filled in", () => {
  const t = 'Hi {first_name},\n\nYour {items} (order {order}) ships Friday.\n\nCleo'
  assert.equal(
    renderNotice(t, { name: '#2243', firstName: 'Ana', items: ['White Cleo Tee, size 1', 'Black Cleo Tee, size 1'] }),
    'Hi Ana,\n\nYour White Cleo Tee, size 1 and Black Cleo Tee, size 1 (order #2243) ships Friday.\n\nCleo',
  )
  assert.equal(renderNotice('Hi {first_name}, thanks.', { name: '#1', firstName: null, items: [] }), 'Hi there, thanks.')
  assert.equal(renderNotice('No placeholders here.', { name: '#1', firstName: 'Ana', items: ['x'] }), 'No placeholders here.')
})

test('the same notice is the same campaign however the colours are typed', () => {
  assert.equal(campaignKey({ product: 'Cleo Tee', colours: ['White', 'Black'] }, 'Ships Friday'), campaignKey({ product: ' cleo tee', colours: ['black', 'white '] }, 'Ships Friday '))
  assert.notEqual(campaignKey(m, 'Ships Friday'), campaignKey(m, 'Ships Monday'))
})

test('the HTML carries the same words, escaped, with the pictures below them', async () => {
  const { noticeHtml } = await import('../lib/notice-pictures')
  const p = { id: 't', label: 't', images: [{ file: 's.png', cid: 'signature', alt: 'love, Cleo', width: 170 }, { file: 'c.jpg', cid: 'collage', alt: '', width: 600 }] }
  const html = noticeHtml('Hi Ana,\n\nShips <Friday> & soon.\nlove', p)
  assert.match(html, /<p[^>]*>Hi Ana,<\/p><p[^>]*>Ships &lt;Friday&gt; &amp; soon\.<br>love<\/p>/)
  const words = html.indexOf('love</p>')
  for (const img of p.images) assert.ok(html.indexOf(`cid:${img.cid}`) > words, `${img.cid} comes after the words`)
  assert.doesNotMatch(noticeHtml('Hi', null), /<img/)
})

test('every picture on the list has its file in public/notice', async () => {
  const { existsSync } = await import('node:fs')
  const { NOTICE_PICTURES } = await import('../lib/notice-pictures')
  for (const p of NOTICE_PICTURES) for (const img of p.images) assert.ok(existsSync(`public/notice/${img.file}`), img.file)
})

test('nothing sends from cleocamp.com itself unless a person chose it for that send', async () => {
  process.env.EMAIL_DRY_RUN = '1'
  const { sendEmail, ROOT_DOMAIN_FROM } = await import('../lib/email')
  const refused = await sendEmail({ from: 'Cleo Studio <support@cleocamp.com>', to: ['x@example.com'], subject: 's', text: 't' })
  assert.equal(refused.sent, false)
  assert.equal((await sendEmail({ from: 'Cleo Studio <support@cleocamp.com>', personChoseRootFrom: true, to: ['x@example.com'], subject: 's', text: 't' })).sent, true)
  assert.ok(!ROOT_DOMAIN_FROM.test('Cleo Studio <support@send.cleocamp.com>'))
  assert.ok(!ROOT_DOMAIN_FROM.test('Studio Mouse <mouse@send.cleocamp.com>'))
})

test('a customer is greeted by the name that is theirs, or by none', async () => {
  const { greetingName } = await import('../lib/waiting-notice')
  const g = (account: string | null, billing: string | null, shipping: string | null, email: string) => greetingName({ account, billing, shipping }, email)
  assert.equal(g('Danielle', 'Danielle', 'Danielle', 'daniellemoreno322@gmail.com'), 'Danielle')
  // The email says whose inbox it is.
  assert.equal(g('Charles', 'Charles', 'Vanessa', 'vanessatraina@gmail.com'), 'Vanessa')
  assert.equal(g('Theodore', 'Theodore', 'Olivia', 'oliviabaumann20@gmail.com'), 'Olivia')
  assert.equal(g('Tania', 'Tania', 'Sophie', 'sophiedodd123@icloud.com'), 'Sophie')
  assert.equal(g('Jiaying', 'Arielle', 'Arielle', 'ariel065le@gmail.com'), 'Arielle')
  assert.equal(g('Maya', 'Maya', 'Farhan', 'mayalynnstewart@gmail.com'), 'Maya') // a gift: the parcel is someone else's
  assert.equal(g('Xela Ann Marie', 'Xela Ann Marie', 'Xela', 'xelapaysforthings@gmail.com'), 'Xela')
  // Card and parcel agree over a stale account name.
  assert.equal(g('Katherine', 'Katy', 'Katy', 'ktbrim@gmail.com'), 'Katy')
  assert.equal(g('Rebecca', 'Becca', 'Becca', 'rebecca.s.cohen2013@gmail.com'), 'Becca') // the address holds both; card and parcel settle it
  // Account and card agree, and the address starts with that letter.
  assert.equal(g('Suzanne', 'Suzanne', 'Master', 'suzyz@msn.com'), 'Suzanne')
  assert.equal(g('Emma', 'Emma', 'Emmy', 'e.wohl13@gmail.com'), 'Emma')
  assert.equal(g('Linda', 'Linda', 'LC', 'lcbutton17@gmail.com'), 'Linda') // LC is initials
  assert.equal(g('Madelin Rose', 'Madelin Rose', 'Madeline', 'madcremin@gmail.com'), 'Madelin Rose')
  // Nothing settles it: no name rather than a wrong one.
  assert.equal(g('Joshua', 'Joshua', 'Ali', 'stephmbank@gmail.com'), null)
  // Initials are not names.
  assert.equal(g('George', 'George', 'G', 'gchurchill62@gmail.com'), 'George')
  assert.equal(g('Laura H', 'Laura H', 'Laura H.', 'lhm@laurahmiller.com'), 'Laura')
  // All agree: the whole name as written, capitalised if typed in lower case.
  assert.equal(g('Catherine Adair', 'Catherine Adair', 'Catherine Adair', 'adair.ilyinsky@gmail.com'), 'Catherine Adair')
  assert.equal(g('sarah', 'sarah', 'Sarah', 'sphelantiedman@gmail.com'), 'Sarah')
  assert.equal(g('maryn', 'maryn', 'maryn', 'maryn.schutz@gmail.com'), 'Maryn')
  assert.equal(g(null, '', null, 'x@y.com'), null)
})
