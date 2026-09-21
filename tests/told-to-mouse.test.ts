import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitAuthored, renderWhoSaidWhat, type Said } from '../lib/mouse/who-said-what'

// The parser is load-bearing. A regex that misses silently reports that
// nobody said anything, which is the same email as a quiet day.
test('it finds the author on every shape a turn actually takes', () => {
  assert.deepEqual(splitAuthored('[Cleo, Founder] the cotton arrived'), { person: 'Cleo', said: 'the cotton arrived' })
  assert.deepEqual(splitAuthored('[Jane Labash, dictated from their phone] hello'), { person: 'Jane Labash', said: 'hello' })
  assert.deepEqual(splitAuthored('[Brandon] plain'), { person: 'Brandon', said: 'plain' })
  assert.equal(splitAuthored('no brackets at all'), null, 'an unauthored turn has no author to report')
  assert.equal(splitAuthored('[Cleo] '), null, 'an author who said nothing is not an update')
  assert.equal(splitAuthored('[] something'), null)
})

const one = (over: Partial<Said> = {}): Said => ({
  person: 'Cleo', at: new Date('2026-09-21T16:12:00Z'), said: 'the cotton arrived',
  recorded: ['note against Antonio’s'], replied: '', ...over,
})

test('what was written down is reported beside what was said', () => {
  const { text, html } = renderWhoSaidWhat([one()])
  assert.match(text, /recorded: note against/)
  assert.match(html, /note against/)
})

test('a silent update is called out, not omitted', () => {
  // The whole point. An update that reached nothing looks identical to one
  // that worked, unless the email says so.
  const { text, html } = renderWhoSaidWhat([one({ recorded: [] })])
  assert.match(text, /NOTHING WAS RECORDED/)
  assert.match(html, /Nothing was written down/)
})

test('the subject names who spoke', () => {
  assert.equal(renderWhoSaidWhat([one()]).subject, 'What Cleo told Mouse')
  assert.equal(
    renderWhoSaidWhat([one(), one({ person: 'Jane Labash' })]).subject,
    'What Cleo and Jane Labash told Mouse',
  )
})

test('what people say cannot break the email', () => {
  const { html } = renderWhoSaidWhat([one({ said: '<script>alert(1)</script> & "quotes"' })])
  assert.ok(!html.includes('<script>'), 'a dictated angle bracket must not become markup')
  assert.match(html, /&lt;script&gt;/)
})
