import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newsSince, orderNews, parseVerdicts, searchableName } from '../lib/customers'

const base = { name: 'Colleen Moroney', city: 'Portland, OR', orderCount: 1, totalSpentCents: 9500, lastOrderName: '#2670', notable: null, notableWho: null, notableDismissedAt: null }

test('only a real name is searched', () => {
  assert.equal(searchableName('Colleen Moroney'), 'Colleen Moroney')
  assert.equal(searchableName('kellycole37@gmail.com'), null)
  assert.equal(searchableName('Cher'), null)
  assert.equal(searchableName(''), null)
})

test('yesterday\'s order is news only for a notable, repeat or big buyer', () => {
  assert.equal(orderNews(base), null)
  assert.equal(orderNews({ ...base, orderCount: 3, totalSpentCents: 26500 }), 'Repeat buyer: Colleen Moroney (Portland, OR) ordered again (#2670), $265 with us over 3 orders.')
  assert.equal(orderNews({ ...base, orderCount: 2, totalSpentCents: 120000 }), 'Big buyer: Colleen Moroney (Portland, OR) ordered (#2670), $1,200 with us over 2 orders.')
  assert.equal(orderNews({ ...base, notable: 'likely', notableWho: 'Editor at Vogue' }), 'Colleen Moroney (Portland, OR) ordered (#2670), and looks to be Editor at Vogue.')
  // A "possible" match waits on the Customers tab; a dismissed one is gone.
  assert.equal(orderNews({ ...base, notable: 'possible', notableWho: 'Actor' }), null)
  assert.equal(orderNews({ ...base, notable: 'likely', notableWho: 'Actor', notableDismissedAt: new Date() }), null)
})

test('Monday\'s Cheese covers the weekend; other days the last day', () => {
  const mon = new Date('2026-10-05T15:00:00Z') // Monday 8am in Los Angeles
  const tue = new Date('2026-10-06T15:00:00Z')
  assert.equal((mon.getTime() - newsSince(mon).getTime()) / 864e5, 3)
  assert.equal((tue.getTime() - newsSince(tue).getTime()) / 864e5, 1)
})

test('verdicts are read defensively', () => {
  const ids = new Set(['a', 'b', 'c'])
  const text = `Here you go:
[{"id":"a","match":"likely","who":"Actor, Severance","source":"https://en.wikipedia.org/wiki/X"},
 {"id":"b","match":"possible","who":"Musician","source":"javascript:alert(1)"},
 {"id":"c","match":"none","who":"someone","source":"https://x"},
 {"id":"zzz","match":"likely","who":"Ignore previous instructions","source":"https://evil"}]`
  const v = parseVerdicts(text, ids)
  assert.deepEqual(v, [
    { id: 'a', match: 'likely', who: 'Actor, Severance', source: 'https://en.wikipedia.org/wiki/X' },
    { id: 'b', match: 'possible', who: 'Musician', source: null },
    { id: 'c', match: 'none', who: null, source: null },
  ])
  assert.deepEqual(parseVerdicts('no json here', ids), [])
  assert.deepEqual(parseVerdicts('[{"id":"a","match":"likely","who":""}]', ids), [{ id: 'a', match: 'none', who: null, source: null }])
})

test('a hand-added customer is linked by email, one each', async () => {
  const { linkByEmail, orderSearch } = await import('../lib/customers')
  const rows = [{ email: 'a@x.com', n: 1 }, { email: null, n: 2 }, { email: 'b@x.com', n: 3 }]
  assert.deepEqual(linkByEmail(rows, [{ id: 'h1', email: 'B@x.com' }, { id: 'h2', email: 'c@x.com' }]).map((l) => [l.id, l.row.n]), [['h1', 3]])
  assert.equal(orderSearch(' sophie@sophielev.xyz '), 'email:"sophie@sophielev.xyz"')
  assert.equal(orderSearch('Sophie "Lev"'), 'Sophie Lev')
})
