import { test } from 'node:test'
import assert from 'node:assert/strict'
import type Anthropic from '@anthropic-ai/sdk'
import {
  EMAIL_INDEX_MAX_CHARS, EMAIL_PREVIEW_CHARS, emailIdProblem, emailIndex, emailSearchWhere, ONE_EMAIL_PER_TURN, openEmail, previewOf, type InboundRow,
} from '../lib/email-lookup'
import { runLoop } from '../lib/mouse/runner'
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

// ── One whole email per turn, kept by the tool loop (Codex, 9 Oct 2026) ──────

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Usage
const call = (name: string, input: Record<string, unknown>, id: string): Anthropic.ToolUseBlock => ({ type: 'tool_use', caller: { type: 'direct' }, name, id, input })
const reply = (content: Anthropic.ContentBlock[], stop_reason: Anthropic.StopReason = 'tool_use') => ({ content, stop_reason, usage })
const done = (text: string) => reply([{ type: 'text', text, citations: null }], 'end_turn')
const tools: Anthropic.Tool[] = ['query_status', 'open_email'].map((name) => ({ name, input_schema: { type: 'object' } }))
const loopBase = { system: [], messages: [{ role: 'user' as const, content: 'What did the buyer order?' }], tools, model: 'normal' }

/** The mail, and the email tools as the loop runs them, with every database read counted. */
function mailbox() {
  const a = row({ subject: 'Re: Invoice 1042', fromAddress: 'Buyer <buyer@example-shop.com>', text: 'Please invoice 6 Bean Bags, Petite, Red.' })
  const b = row({ subject: 'Invoice 1042 (old)', text: 'Different invoice.' })
  const store = new Map([a, b].map((r) => [r.id, r]))
  const reads: string[] = []
  const execute = async (name: string, input: unknown) => {
    const i = input as Record<string, unknown>
    if (name === 'query_status') return emailIndex([a, b], { since: '2026-10-01', subject: 'invoice' })
    if (name === 'open_email') return openEmail(i.id, async (id) => { reads.push(id); return store.get(id) ?? null })
    throw new Error(`unexpected ${name}`)
  }
  return { a, b, reads, execute }
}
const results = (req: { messages: Anthropic.MessageParam[] }) => req.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]

test('two open_email calls in one response: one database read, the second refused', async () => {
  const m = mailbox()
  let turn = 0
  let seen: Anthropic.ToolResultBlockParam[] = []
  const r = await runLoop({ ...loopBase, execute: m.execute,
    create: async (req) => {
      if (turn++ === 0) return reply([call('open_email', { id: m.a.id }, 't1'), call('open_email', { id: m.b.id }, 't2')])
      seen = results(req)
      return done('6 Petite Red Bean Bags.')
    },
  })
  assert.deepEqual(m.reads, [m.a.id], 'exactly one read, of the first email')
  assert.equal(seen[0].is_error, false)
  assert.match(String(seen[0].content), /Please invoice 6 Bean Bags, Petite, Red\./, 'the first email reaches the model in full')
  assert.equal(seen[1].is_error, true)
  assert.equal(seen[1].content, ONE_EMAIL_PER_TURN)
  assert.equal(r.toolCalls[1].status, 'failed')
  assert.equal(r.text, '6 Petite Red Bean Bags.')
})

test('a second open_email in a later round is refused too, without a read', async () => {
  const m = mailbox()
  let turn = 0
  let second: Anthropic.ToolResultBlockParam[] = []
  await runLoop({ ...loopBase, execute: m.execute,
    create: async (req) => {
      turn++
      if (turn === 1) return reply([call('open_email', { id: m.a.id }, 't1')])
      if (turn === 2) return reply([call('open_email', { id: m.b.id }, 't2')])
      second = results(req)
      return done('From the first email: 6 Petite Red.')
    },
  })
  assert.deepEqual(m.reads, [m.a.id])
  assert.equal(second[0].is_error, true)
  assert.match(String(second[0].content), /already been opened this turn/)
})

test('search, then one open, then the answer: the normal flow is untouched, and searches stay free', async () => {
  const m = mailbox()
  let turn = 0
  let afterSearch = '', afterOpen = ''
  const r = await runLoop({ ...loopBase, execute: m.execute,
    create: async (req) => {
      turn++
      if (turn === 1) return reply([call('query_status', { what: 'email', subject: 'invoice' }, 's1')])
      if (turn === 2) {
        afterSearch = String(results(req)[0].content)
        const id = (JSON.parse(afterSearch) as { emails: Array<{ id: string; subject: string }> }).emails.find((e) => e.subject === 'Re: Invoice 1042')!.id
        return reply([call('open_email', { id }, 'o1')])
      }
      if (turn === 3) { afterOpen = String(results(req)[0].content); return reply([call('query_status', { what: 'email', subject: 'invoice' }, 's2')]) }
      return done('They ordered 6 Petite Red Bean Bags.')
    },
  })
  assert.ok(!afterSearch.includes('Please invoice 6 Bean Bags, Petite, Red.') || afterSearch.length < 2_000, 'the search is the compact list')
  assert.match(afterOpen, /Please invoice 6 Bean Bags, Petite, Red\./)
  assert.deepEqual(m.reads, [m.a.id], 'one read; the search after it is still allowed')
  assert.deepEqual(r.toolCalls.map((c) => [c.name, c.status]), [['query_status', 'succeeded'], ['open_email', 'succeeded'], ['query_status', 'succeeded']])
  assert.equal(r.text, 'They ordered 6 Petite Red Bean Bags.')
})

test('a malformed id never reaches the database, so it does not use up the one open', async () => {
  const m = mailbox()
  let turn = 0
  await runLoop({ ...loopBase, execute: m.execute,
    create: async () => {
      turn++
      if (turn === 1) return reply([call('open_email', { id: 'latest' }, 'x1'), call('open_email', { id: m.a.id }, 'x2'), call('open_email', { id: m.b.id }, 'x3')])
      return done('ok')
    },
  })
  assert.deepEqual(m.reads, [m.a.id])
})
