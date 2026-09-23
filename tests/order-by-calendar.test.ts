import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planOrderByCalendar } from '../lib/order-by-calendar'

const today = new Date('2026-09-22T00:00:00Z')
const d = (s: string) => new Date(s + 'T00:00:00Z')
const want = (title: string, date: string) => ({ title, date: d(date), productId: null, notes: null })

test('stale entries for a forecast that moved are removed, and the current one kept', () => {
  // The real case: Cleo Bag Black on the calendar today and tomorrow, forecast now 14 Dec.
  const plan = planOrderByCalendar(
    [want('Order Cleo Bag — Black', '2026-12-14')],
    [
      { id: 'a', title: 'Order Cleo Bag — Black', date: d('2026-09-22') },
      { id: 'b', title: 'Order Cleo Bag — Black', date: d('2026-09-23') },
      { id: 'c', title: 'Order Cleo Bag — Black', date: d('2026-12-14') },
    ],
    today,
  )
  assert.deepEqual(plan.remove.sort(), ['a', 'b'])
  assert.deepEqual(plan.create, [], 'the right one already exists — nothing new to write')
})

test('a missing entry is created, once', () => {
  const plan = planOrderByCalendar([want('Order Cleo Tee', '2026-12-19')], [], today)
  assert.equal(plan.create.length, 1)
  assert.equal(plan.remove.length, 0)
})

test('duplicates on the right date collapse to one', () => {
  const plan = planOrderByCalendar(
    [want('Order Bean Bag', '2026-12-15')],
    [
      { id: 'x', title: 'Order Bean Bag', date: d('2026-12-15') },
      { id: 'y', title: 'Order Bean Bag', date: d('2026-12-15') },
    ],
    today,
  )
  assert.deepEqual(plan.remove, ['y'])
  assert.equal(plan.create.length, 0)
})

test('an entry for something no longer forecast is removed', () => {
  const plan = planOrderByCalendar([], [{ id: 'z', title: 'Order Hair Tie', date: d('2026-10-01') }], today)
  assert.deepEqual(plan.remove, ['z'])
})

test('an overdue order-by gets no calendar entry — the alert covers it', () => {
  const plan = planOrderByCalendar([want('Order Cleo Bag — Silver', '2026-09-04')], [], today)
  assert.equal(plan.create.length, 0)
})

test('past entries are left alone as history', () => {
  const plan = planOrderByCalendar([], [{ id: 'old', title: 'Order Cleo Tee', date: d('2026-09-13') }], today)
  assert.deepEqual(plan.remove, [])
})
