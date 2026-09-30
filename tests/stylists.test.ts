import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickStylist } from '../lib/stylists'

const all = [
  { id: 'nat', name: 'Natasha Colvin' },
  { id: 'maya', name: 'Maya (ellner studio)' },
  { id: 'nat2', name: 'Natalie Price' },
]

test('the Natasha pull filed under Maya is refused', () => {
  const r = pickStylist(all, 'maya', 'Natasha Colvin')
  assert.ok('reason' in r)
  assert.match((r as { reason: string }).reason, /is Maya \(ellner studio\), not Natasha Colvin/)
})

test('by name, whole or in part', () => {
  assert.deepEqual(pickStylist(all, null, 'Natasha Colvin'), { stylist: all[0] })
  assert.deepEqual(pickStylist(all, null, 'colvin'), { stylist: all[0] })
  assert.deepEqual(pickStylist(all, null, 'Maya'), { stylist: all[1] })
  assert.deepEqual(pickStylist(all, 'nat', 'Natasha'), { stylist: all[0] })
})

test('two matches is a question, none is a question', () => {
  assert.match((pickStylist(all, null, 'Nat') as { reason: string }).reason, /More than one/)
  assert.match((pickStylist(all, null, 'Sofie') as { reason: string }).reason, /No stylist called/)
  assert.match((pickStylist(all, 'nope', null) as { reason: string }).reason, /No stylist nope/)
})
