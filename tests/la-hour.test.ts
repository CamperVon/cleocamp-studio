import assert from 'node:assert/strict'
import test from 'node:test'
import { laHour } from '../lib/dates'

test('15:00 UTC is 8am in LA in summer and 7am in winter; 16:00 UTC is 8am in winter', () => {
  assert.equal(laHour(new Date('2026-10-28T15:20:00Z')), 8)
  assert.equal(laHour(new Date('2026-11-03T15:20:00Z')), 7)
  assert.equal(laHour(new Date('2026-11-03T16:20:00Z')), 8)
  assert.equal(laHour(new Date('2026-11-03T08:00:00Z')), 0)
})
