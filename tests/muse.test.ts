import assert from 'node:assert/strict'
import test from 'node:test'
import { ASK_TEAM, checkQuestion, checkReport, museAuthorized, museKey, readAnswer, taskForMuse } from '../lib/muse'

const KEY = 'k'.repeat(40)

test('the Muse API answers only its own key, and is off without one', () => {
  assert.equal(museAuthorized(`Bearer ${KEY}`, KEY), true)
  assert.equal(museAuthorized(`Bearer ${KEY}x`, KEY), false)
  assert.equal(museAuthorized(KEY, KEY), false) // no "Bearer"
  assert.equal(museAuthorized(null, KEY), false)
  assert.equal(museAuthorized(`Bearer ${KEY}`, undefined), false) // no key set: off
  assert.equal(museAuthorized('Bearer short', 'short'), false) // a weak key never works
})

test('harmless variations of the right key still work; a wrong key still does not', () => {
  assert.equal(museAuthorized(`bearer ${KEY}`, KEY), true)
  assert.equal(museAuthorized(`Bearer   ${KEY}  `, KEY), true)
  assert.equal(museAuthorized(null, KEY, ` ${KEY}\n`), true) // X-API-Key
  assert.equal(museAuthorized(null, museKey(`${KEY}\n`), KEY), true) // a line break pasted into Vercel
  assert.equal(museAuthorized(null, KEY, `${KEY}x`), false)
  assert.equal(museAuthorized('Basic abc', KEY), false)
})

test('a question must be text, and not too long', () => {
  assert.deepEqual(checkQuestion({ question: '  Is 16 momme required? ' }), { question: 'Is 16 momme required?' })
  assert.ok('error' in checkQuestion({}))
  assert.ok('error' in checkQuestion({ question: 42 }))
  assert.ok('error' in checkQuestion({ question: 'x'.repeat(2001) }))
})

test('a report is checked before anything is stored', () => {
  const ok = checkReport({
    summary: 'Two cheaper sources found.',
    report: '# Findings\n...',
    sources: [{ name: 'Mill A', url: 'https://example.com/a', price: 18.5, currency: 'USD', unit: 'yard' }],
  })
  assert.ok(!('error' in ok))
  if (!('error' in ok)) {
    assert.equal(ok.sources[0].price, '18.5')
    assert.equal(ok.pdf, null)
  }
  assert.ok('error' in checkReport({ report: 'x' })) // no summary
  assert.ok('error' in checkReport({ summary: 'x' })) // no report
  assert.ok('error' in checkReport({ summary: 'x', report: 'y', sources: [{ url: 'javascript:alert(1)' }] }))
  assert.ok('error' in checkReport({ summary: 'x', report: 'y', sources: 'nope' }))
  assert.ok('error' in checkReport({ summary: 'x', report: 'y', pdf: Buffer.from('not a pdf').toString('base64') }))
  const pdf = checkReport({ summary: 'x', report: 'y', pdf: Buffer.from('%PDF-1.4 tiny').toString('base64') })
  assert.ok(!('error' in pdf) && pdf.pdf)
})

test("Mouse's answer either answers or goes to the team; it never guesses", () => {
  assert.deepEqual(readAnswer('About 40 yards over the last two orders.'), { answer: 'About 40 yards over the last two orders.' })
  assert.deepEqual(readAnswer(`${ASK_TEAM}\nWhat is the most we would pay per yard?`), { askTeam: 'What is the most we would pay per yard?' })
})

test('Muse sees an answer only once it is answered, and file links need its key', () => {
  const t = {
    id: 't1', number: 3, title: 'Black silk', status: 'OPEN', createdAt: new Date('2026-10-07T18:00:00Z'), brief: 'Find a better price.', reportedAt: null,
    questions: [
      { id: 'q1', question: 'Width?', answer: '54 in', status: 'ANSWERED', createdAt: new Date('2026-10-07T19:00:00Z') },
      { id: 'q2', question: 'Max price?', answer: null, status: 'ASKED_TEAM', createdAt: new Date('2026-10-07T19:05:00Z') },
    ],
  } as unknown as Parameters<typeof taskForMuse>[0]
  const v = taskForMuse(t, [{ id: 'f1', title: 'Colour card', mediaType: 'application/pdf', sizeBytes: 1000 }], 'https://admin.cleocamp.com')
  assert.equal(v.status, 'open')
  assert.deepEqual(v.questions.map((q) => [q.status, q.answer]), [['answered', '54 in'], ['pending', null]])
  assert.equal(v.files[0].url, 'https://admin.cleocamp.com/api/muse/tasks/t1/files/f1')
})
