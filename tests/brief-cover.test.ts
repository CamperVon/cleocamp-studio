import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverLine } from '../lib/mouse/brief-cover'

// Synthetic figures shaped like the Cleo Tee on 7 Oct 2026.
const today = new Date('2026-10-07T00:00:00Z')
const due = new Date('2026-10-13T00:00:00Z')

test('a backlog with a dated delivery: what is left once it lands, worked out', () => {
  const l = coverLine({ label: 'Cleo Tee / Black / 1', onHand: -144, perDay: 3.3, incoming: [{ po: '2360', qty: 510, due }] }, today)
  // 6 days at 3.3 a day is about 20 more; -144 - 20 + 510 = 346.
  assert.equal(l, 'Cleo Tee / Black / 1: -144 now, selling about 3.3 a day. 510 due 13 Oct on PO 2360; about 20 more sell before then, so about 346 left once it lands.')
})

test('a delivery too small to cover it says how short it stays', () => {
  const l = coverLine({ label: 'X / 2', onHand: -80, perDay: 2, incoming: [{ po: '9001', qty: 50, due }] }, today)
  assert.match(l, /still about 42 short once it lands/)
})

test('nothing on order, no date, and later deliveries are each said plainly', () => {
  assert.equal(coverLine({ label: 'Y', onHand: -9, perDay: 0, incoming: [] }, today), 'Y: -9 now, no recent sales. Nothing on order.')
  assert.match(coverLine({ label: 'Y', onHand: -9, perDay: 1, incoming: [{ po: '9002', qty: 30, due: null }] }, today), /Nothing on order with a date\. 30 more on order \(PO 9002\) with no date confirmed\./)
  const two = coverLine({ label: 'Z', onHand: -10, perDay: 1, incoming: [{ po: '9003', qty: 20, due }, { po: '9004', qty: 40, due: new Date('2026-10-30T00:00:00Z') }] }, today)
  assert.match(two, /20 due 13 Oct on PO 9003; about 6 more sell before then, so about 4 left once it lands\. Then 40 more due later \(PO 9004, 30 Oct\)\./)
})

test('an overdue delivery counts no further sales', () => {
  assert.match(coverLine({ label: 'W', onHand: -5, perDay: 4, incoming: [{ po: '9005', qty: 10, due: new Date('2026-10-01T00:00:00Z') }] }, today), /due today or overdue on PO 9005; about 0 more sell before then, so about 5 left/)
})
