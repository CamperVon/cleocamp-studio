import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driftThreshold, observedLeadDays, worthAsking, questionFor } from '../lib/lead-time-core'

test('the threshold scales with the number, with a floor', () => {
  assert.equal(driftThreshold(0), 3, 'a zero-day lead time is not asked about over one day of noise')
  assert.equal(driftThreshold(10), 3, 'the floor, not 25% of a small number')
  assert.equal(driftThreshold(28), 7, '25% of a real fabric lead time')
})

test('observed days runs from the deposit when there is one, else the order', () => {
  const ordered = new Date('2026-09-01T12:00:00Z')
  const deposit = new Date('2026-09-03T12:00:00Z')
  const received = new Date('2026-09-15T12:00:00Z')
  assert.equal(observedLeadDays(ordered, deposit, received), 12, 'from the deposit, not the order')
  assert.equal(observedLeadDays(ordered, null, received), 14, 'no deposit — from the order')
})

test('an unusable gap comes back null rather than a wrong number', () => {
  const day = new Date('2026-09-10T12:00:00Z')
  assert.equal(observedLeadDays(null, null, day), null, 'nothing to count from')
  assert.equal(observedLeadDays(day, null, null), null, 'no delivery yet')
  assert.equal(observedLeadDays(day, null, day), null, 'same day is not a real gap to learn from')
  assert.equal(observedLeadDays(new Date('2026-09-15T12:00:00Z'), null, day), null, 'received before ordered — a date entered out of order, not evidence')
})

test('nothing on file is always worth asking about, whatever was observed', () => {
  assert.equal(worthAsking(null, 1), true)
  assert.equal(worthAsking(null, 0), true)
})

test('small drift on a real number is left alone', () => {
  assert.equal(worthAsking(21, 22), false, 'one day off a three-week lead time is noise')
  assert.equal(worthAsking(21, 27), true, 'six days off is not — past driftThreshold(21) = 6')
})

test('the question names the exact figure either way', () => {
  const po = 2357
  const start = new Date('2026-09-03')
  const received = new Date('2026-09-15')
  const settingUnknown = questionFor(
    { entityType: 'COMPONENT', entityId: 'c1', name: 'Fine rib cotton', recorded: null },
    12, String(po), 'the order', start, received,
  )
  assert.match(settingUnknown.title, /Set Fine rib cotton's lead time/)
  assert.match(settingUnknown.detail, /No lead time on file/)
  assert.match(settingUnknown.detail, /Set it to 12 days\?/)

  const updating = questionFor(
    { entityType: 'VENDOR', entityId: 'v1', name: 'RichLine', recorded: 21 },
    27, String(po), 'the deposit', start, received,
  )
  assert.match(updating.title, /may have changed/)
  assert.match(updating.detail, /Recorded at 21 days/)
  assert.match(updating.detail, /Update to 27/)
})
