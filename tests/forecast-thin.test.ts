import { test } from 'node:test'
import assert from 'node:assert/strict'
import { thinVariants, thinText } from '../lib/forecast'

// 17 Nov 2026: the dress as a whole had months of cover while two sizes had
// 4 left each, selling about 9 a month. Nothing said so; Jane saw it by eye.

const v = (id: string, onHand: number | null, perMonth: number, incoming = 0) =>
  ({ id, label: id, onHand, ratePerDay: perMonth / 30, incoming })

test('a size that runs out before a new run could land is flagged, thinnest first', () => {
  const r = thinVariants([v('Black / 1', 95, 3), v('Black / 2', 4, 9), v('Black / 3', 4, 6)], 60)
  assert.deepEqual(r.map((x) => x.id), ['Black / 2', 'Black / 3'])
  assert.equal(r[0].perMonth, 9)
  assert.equal(Math.round(r[0].daysLeft), 13)
})

test('what is on order for that size counts', () => {
  assert.equal(thinVariants([v('Black / 2', 4, 9, 50)], 60).length, 0)
})

test('slow sellers, retired sizes and unknown counts are left out', () => {
  assert.equal(thinVariants([v('Red / 6', 0, 1), v('Red / 5', 0, 0), v('Red / 4', null, 20)], 60).length, 0)
})

test('with no lead time, 30 days is the window', () => {
  assert.equal(thinVariants([v('A', 12, 15)], null).length, 1) // 24 days
  assert.equal(thinVariants([v('A', 20, 15)], null).length, 0) // 40 days
})

test('the line reads plainly', () => {
  assert.equal(thinText({ label: 'Black / 2', onHand: 4, daysLeft: 13.3, perMonth: 9 }), 'Black / 2: 4 left, about 9 a month, out in about 13 days')
  assert.equal(thinText({ label: 'Black / 3', onHand: 30, daysLeft: 50, perMonth: 18 }), 'Black / 3: 30 left, about 18 a month, out in about 7 weeks')
  assert.equal(thinText({ label: 'White / 1', onHand: 0, daysLeft: 0, perMonth: 5 }), 'White / 1: 0 left, about 5 a month, out now')
})
