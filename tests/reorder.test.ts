import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reorderRow } from '../lib/reorder'

const today = new Date('2026-10-01T00:00:00Z')
const day = (iso: string, n = 1) => ({ date: new Date(`${iso}T00:00:00Z`), unitsSold: n })

test('rate over 90 days, need = rate × months − on hand − on order', () => {
  // Cleo Bag Black, 1 Oct 2026: 5 sold in 90 days, 1 on hand.
  const r = reorderRow({ label: 'Black', onHand: 1, onOrder: 0, storeAndGift: 0, firstSaleAt: new Date('2026-04-25'), sales: [day('2026-07-10', 2), day('2026-08-20'), day('2026-09-15', 2)] }, today, [3, 4], 90)
  assert.equal(r.days, 90)
  assert.equal(r.perMonth, 1.7)
  assert.deepEqual(r.need, { '3 mo': 5, '4 mo': 6 })
})

test('a colour launched inside the window is rated from its first sale', () => {
  // Chocolate: 7 sold since 23 July, 70 days.
  const r = reorderRow({ label: 'Chocolate', onHand: 1, onOrder: 0, storeAndGift: 0, firstSaleAt: new Date('2026-07-23T00:00:00Z'), sales: [day('2026-07-23', 3), day('2026-08-30', 2), day('2026-09-20', 2)] }, today, [3], 90)
  assert.equal(r.days, 70)
  assert.equal(r.perMonth, 3)
  assert.equal(r.need['3 mo'], 9)
})

test('what is on order counts; never below zero; unknown stock is unknown need', () => {
  const sales = [day('2026-07-10', 3), day('2026-08-10', 3), day('2026-09-10', 3)]
  assert.equal(reorderRow({ label: 'x', onHand: 6, onOrder: 7, storeAndGift: 0, firstSaleAt: null, sales }, today, [3]).need['3 mo'], 0)
  assert.equal(reorderRow({ label: 'x', onHand: null, onOrder: 0, storeAndGift: 0, firstSaleAt: null, sales }, today, [3]).need['3 mo'], null)
})

test('closing a PO names what never came', async () => {
  const { shortfall } = await import('../lib/po-close')
  assert.deepEqual(shortfall([
    { label: 'Bean Bag / Black / Petite', ordered: 10, received: 3, unit: 'pcs' },
    { label: 'Bean Bag / Red / Petite', ordered: 10, received: 10, unit: 'pcs' },
  ]), ['Bean Bag / Black / Petite: 3 of 10 pcs came, 7 never will'])
})

test('the default reads the whole history from the first sale, with the last 30 days beside it', () => {
  // Bean Bag Black Petite: 12 since 11 June (3,3,4,2 by month), 2 in September.
  const sales = [day('2026-06-11', 3), day('2026-07-15', 3), day('2026-08-15', 4), day('2026-09-10', 2)]
  const r = reorderRow({ label: 'Black Petite', onHand: 6, onOrder: 0, storeAndGift: 0, firstSaleAt: new Date('2026-06-11T00:00:00Z'), sales }, today, [3])
  assert.equal(r.days, 112)
  assert.equal(r.perMonth, 3.3)
  assert.equal(r.last30PerMonth, 2)
  assert.equal(r.need['3 mo'], 4)
})
