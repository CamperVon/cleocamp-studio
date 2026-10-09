import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMAIL_INDEX_MAX_CHARS, EMAIL_PREVIEW_CHARS, emailIdProblem, emailIndex, emailSearchWhere, openEmail, previewOf, type InboundRow,
} from '../lib/email-lookup'
import { resultChars, storedResult } from '../lib/mouse/outcomes'
import { TOOLS } from '../lib/mouse/tools'
import { TOOL_KINDS } from '../lib/mouse/tool-kinds'
import { PROPOSAL_TOOLS } from '../lib/mouse/agent'

// Codex review, 9 Oct 2026: query_status "email" handed Mouse the 20 newest
// emails in full, 110,000 to 159,000 characters a time, replayed every round.
// Synthetic mail below; no real addresses.

let n = 0
const row = (o: Partial<InboundRow> = {}): InboundRow => ({
  id: `cm${String(++n).padStart(4, '0')}abcdefghijklmnopqrstu`,
  fromAddress: 'Vendor <orders@example-vendor.com>', toAddress: 'mouse@send.example.com',
  subject: 'Hello', text: 'Short note.', html: null, raw: { data: { attachments: [] } },
  receivedAt: new Date(Date.UTC(2026, 9, 8, 18, 0) - n * 60_000), ...o,
})

const huge = 'Line of a very long quoted thread that goes on and on. '.repeat(40_000) // ~2.2M chars

test('a huge email cannot make the compact search exceed its limit', () => {
  const rows = Array.from({ length: 25 }, () => row({
    text: huge, html: `<p>${huge}</p>`, subject: 'S'.repeat(5_000), fromAddress: 'x'.repeat(5_000), toAddress: 'y'.repeat(5_000),
    raw: { data: { attachments: Array.from({ length: 60 }, (_, i) => ({ filename: `${'n'.repeat(500)}-${i}.pdf`, content_type: 'application/pdf' })) } },
  }))
  const out = emailIndex(rows, { since: '2026-09-08' })
  const size = JSON.stringify(out).length
  assert.ok(size <= EMAIL_INDEX_MAX_CHARS, `${size} > ${EMAIL_INDEX_MAX_CHARS}`)
  assert.ok(out.emails.length > 0, 'still lists what fits')
  for (const e of out.emails) {
    assert.ok(e.preview.length <= EMAIL_PREVIEW_CHARS)
    assert.ok(!('text' in e) && !('html' in e) && !('body' in e), 'no body field of any kind')
    assert.ok(e.attachments.count === 60 && e.attachments.names.length <= 8)
  }
  assert.match(out.notShown ?? '', /left off to keep the list short/)
  assert.match(out.more ?? '', /Only the newest 20/)
})

test('the search keeps what is needed to pick the right email, and leaves quoted thread out of the preview', () => {
  const invoice = row({
    fromAddress: 'Cosmo Buyer <buyer@example-shop.com>', subject: 'Re: Wholesale order',
    text: 'Please invoice 6 Bean Bags and 4 tees.\n\nOn Mon, Oct 6, 2026 at 9:00 AM Studio wrote:\n> Our line sheet is attached.\n> Thanks',
    raw: { data: { attachments: [{ filename: 'PO-77.pdf', content_type: 'application/pdf' }] } },
  })
  const out = emailIndex([row(), invoice, row()], { since: '2026-10-01', subject: 'wholesale' })
  const e = out.emails.find((x) => x.id === invoice.id)!
  assert.equal(e.from, 'Cosmo Buyer <buyer@example-shop.com>')
  assert.equal(e.subject, 'Re: Wholesale order')
  assert.equal(e.received, invoice.receivedAt.toISOString())
  assert.match(e.receivedLA, /Oct/)
  assert.deepEqual(e.attachments, { count: 1, names: ['PO-77.pdf'] })
  assert.equal(e.preview, 'Please invoice 6 Bean Bags and 4 tees.')
  assert.equal(out.subject, 'wholesale')
  assert.match(out.how, /open ONE email with open_email/)
})

test('previews: a forward header ends it; an HTML-only email is read as text, never as markup', () => {
  assert.equal(previewOf('New bit.\n---------- Forwarded message ---------\nFrom: someone\nOld bit'), 'New bit.')
  assert.equal(previewOf('Grazie!\nIl giorno lun 6 ott 2026 Alessandra ha scritto:\nvecchio'), 'Grazie!')
  const e = emailIndex([row({ text: null, html: '<div>Order for <b>Cosmo</b>: 12 bags</div><blockquote>old</blockquote>' })], { since: '2026-10-01' }).emails[0]
  assert.equal(e.bodyIs, 'html only, read as text')
  assert.ok(!/[<>]/.test(e.preview))
  assert.match(e.preview, /Order for Cosmo: 12 bags/)
})

test('customer mail never appears in the search or opens, and the database filter excludes it', async () => {
  const cust = row({ toAddress: 'support@send.example.com', subject: 'Where is my order' })
  assert.deepEqual(emailIndex([cust, row()], { since: '2026-10-01' }).emails.map((e) => e.subject), ['Hello'])
  const opened = await openEmail(cust.id, async () => cust)
  assert.equal(opened.found, false)
  assert.deepEqual(emailSearchWhere({ since: new Date('2026-10-01') }).NOT, { toAddress: { contains: 'support@' } })
  const w = emailSearchWhere({ since: new Date('2026-10-01'), from: ' cosmo ', subject: 'invoice' })
  assert.deepEqual(w.fromAddress, { contains: 'cosmo', mode: 'insensitive' })
  assert.deepEqual(w.subject, { contains: 'invoice', mode: 'insensitive' })
})

test('opening an id returns that one email in full', async () => {
  const want = row({ text: huge, subject: 'Price list', raw: { data: { attachments: [{ filename: 'prices.xlsx', content_type: 'application/vnd.ms-excel' }] } } })
  const other = row({ text: 'not this one' })
  const store = new Map([want, other].map((r) => [r.id, r]))
  const r = await openEmail(want.id, async (id) => store.get(id) ?? null)
  assert.equal(r.found, true)
  if (!r.found) return
  assert.equal(r.id, want.id)
  assert.equal(r.body, huge, 'the complete body, not cut')
  assert.equal(r.bodyChars, huge.length)
  assert.deepEqual(r.attachments, [{ filename: 'prices.xlsx', contentType: 'application/vnd.ms-excel' }])
  const htmlOnly = row({ text: null, html: '<p>Order: 12 Cleo Bags</p>' })
  const h = await openEmail(htmlOnly.id, async () => htmlOnly)
  assert.ok(h.found && h.body === 'Order: 12 Cleo Bags' && /no text part/.test(h.bodyIs ?? ''))
})

test('nonexistent, partial, several or malformed ids fail safely, without a lookup', async () => {
  let looked = 0
  const find = async () => { looked++; return null }
  for (const bad of [undefined, '', '   ', ['cm0001abcdefghijklmnopqrstu'], 'cm0001abcdefghijklmnopqrstu, cm0002abcdefghijklmnopqrstu', 'cm0001 cm0002', 'cm00', 'latest', '../etc/passwd']) {
    const r = await openEmail(bad, find)
    assert.equal(r.found, false, String(bad))
    assert.ok(emailIdProblem(bad))
  }
  assert.equal(looked, 0, 'nothing malformed reaches the database')
  const r = await openEmail('cmzzzzabcdefghijklmnopqrstu', find)
  assert.equal(r.found, false)
  assert.match(r.reason ?? '', /No email has the id/)
  assert.equal(looked, 1)
})

test('the real tool: an id that does not exist is refused, and nothing is changed', async () => {
  const r = await TOOLS.open_email.run({ id: 'cmnotarealidabcdefghijklmn' }) as Record<string, unknown>
  assert.equal(r.found, false)
})

test('open_email is a read-only look-up everywhere query_status is offered', () => {
  assert.equal(TOOL_KINDS.open_email, 'read-lane')
  assert.ok(PROPOSAL_TOOLS.includes('open_email'))
})

test('the turn keeps only ids and sizes of email results, and every result its size', () => {
  const idx = emailIndex([row({ text: 'secret wording here' })], { since: '2026-10-01' })
  const kept = JSON.stringify(storedResult('query_status', { what: 'email' }, idx))
  assert.ok(!kept.includes('secret wording'), 'no preview text kept')
  assert.match(kept, /emailIds/)
  const opened = { found: true, id: 'cm1', body: 'secret wording here', bodyChars: 19 }
  assert.deepEqual(storedResult('open_email', { id: 'cm1' }, opened), { found: true, id: 'cm1', bodyChars: 19, textNotKept: true })
  assert.deepEqual(storedResult('query_status', { what: 'events' }, [{ a: 1 }]), [{ a: 1 }], 'other results as before')
  assert.equal(resultChars('abcde'), 5)
  assert.equal(resultChars([{ type: 'text', text: 'abc' }, { type: 'image', source: { data: 'xxxx' } }]), 7)
})

test('a normal invoice look-up: search narrows to it, its id opens it, and the line is there', async () => {
  const mail = [
    row({ subject: 'Line sheet', fromAddress: 'Shop A <a@example-a.com>', text: 'Thanks for the line sheet.' }),
    row({ subject: 'Re: Invoice 1042', fromAddress: 'Cosmo Buyer <buyer@example-shop.com>', text: `Hi,\nPlease invoice: 6 Bean Bag Petite Red at wholesale, ship to Savannah.\n${'More detail. '.repeat(3000)}\nOn Tue someone wrote:\n> old` }),
    row({ subject: 'Invoice 1042 (old)', fromAddress: 'Accounts <ap@example-other.com>', text: 'Different invoice.' }),
  ]
  const store = new Map(mail.map((r) => [r.id, r]))
  // What the database filter does, for this test's rows.
  const where = emailSearchWhere({ since: new Date('2026-10-01'), from: 'cosmo', subject: 'invoice' })
  const matched = mail.filter((r) => r.fromAddress.toLowerCase().includes(where.fromAddress!.contains) && (r.subject ?? '').toLowerCase().includes(where.subject!.contains))
  const list = emailIndex(matched, { since: '2026-10-01', from: 'cosmo', subject: 'invoice' })
  assert.equal(list.emails.length, 1)
  assert.match(list.emails[0].preview, /^Hi, Please invoice: 6 Bean Bag Petite Red/)
  assert.ok(JSON.stringify(list).length < 2_000, 'one compact row, not the 39,000-character body')
  const opened = await openEmail(list.emails[0].id, async (id) => store.get(id) ?? null)
  assert.ok(opened.found)
  if (opened.found) assert.match(opened.body, /6 Bean Bag Petite Red at wholesale, ship to Savannah/)
})
