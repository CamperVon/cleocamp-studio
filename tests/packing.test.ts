import assert from 'node:assert/strict'
import test from 'node:test'
import { coveredDays, dayBefore, daysBetween, packingDay, packingFor, packingForOrders, PACKING_NOTE } from '../lib/packing'
import { packagesFrom } from '../lib/integrations/shopify'

const one = (product: string, quantity = 1) => ({ product, quantity })

test('a package takes a mailer, an envelope or a box by how many items are loose in it', () => {
  assert.equal(packingFor([one('Cleo Tee'), one('You Dress')]).mailer, 1)
  assert.equal(packingFor([one('Cleo Tee', 3)]).mailer, 1)
  const four = packingFor([one('Cleo Tee', 4)])
  assert.deepEqual([four.mailer, four.envelope, four.box], [0, 1, 0])
  const six = packingFor([one('Cleo Tee', 3), one('You Dress', 3)])
  assert.deepEqual([six.mailer, six.envelope, six.box], [0, 0, 1])
})

test('bags pack their own way; tees never take newsprint', () => {
  const cleo = packingFor([one('Cleo Bag — Black')])
  assert.deepEqual([cleo.box, cleo.newsprint, cleo.mailer], [1, 2, 0])
  const bean = packingFor([one('Bean Bag', 2)])
  assert.deepEqual([bean.mailer, bean.newsprint, bean.box], [2, 2, 0])
  // A Cleo Bag and two tees: the bag in its box, the tees in a mailer.
  const mixed = packingFor([one('Cleo Bag — Silver'), one('Cleo Tee', 2)])
  assert.deepEqual([mixed.box, mixed.newsprint, mixed.mailer], [1, 2, 1])
  assert.equal(packingFor([one('Cleo Tee', 2)]).newsprint, 0)
})

test('every package gets a postcard, two shipping labels and a 25th of a roll of tape', () => {
  const t = packingForOrders(Array.from({ length: 25 }, () => ({ items: [one('Cleo Tee')] })))
  assert.equal(t.postcard, 25)
  assert.equal(t.label, 50)
  assert.ok(Math.abs(t.tape - 1) < 1e-9)
  assert.equal(packingFor([]).postcard, 0)
  assert.equal(packingFor([]).label, 0)
})

test('two shipping labels per package, however much is in it', () => {
  // A Cleo Bag, a Bean Bag and six tees ship as one package: two labels.
  assert.equal(packingFor([one('Cleo Bag — Black'), one('Bean Bag'), one('Cleo Tee', 6)]).label, 2)
  // The same items as three packages (three fulfilments): six labels.
  assert.equal(packingForOrders([{ items: [one('Cleo Bag — Black')] }, { items: [one('Bean Bag')] }, { items: [one('Cleo Tee', 6)] }]).label, 6)
})

test('a shipped package is one successful fulfilment; cancelled ones and wholesale do not count', () => {
  const li = (title: string, quantity = 1) => ({ quantity, lineItem: { title, requiresShipping: true, variant: { id: `gid://shopify/ProductVariant/${title}` } } })
  const order = {
    name: '#2316', cancelledAt: null, tags: [],
    fulfillments: [
      { createdAt: '2026-09-09T22:00:26Z', status: 'SUCCESS', fulfillmentLineItems: { nodes: [li('Cleo Tee')] } },
      { createdAt: '2026-09-22T22:01:12Z', status: 'SUCCESS', fulfillmentLineItems: { nodes: [li('You Dress')] } },
      { createdAt: '2026-09-22T22:30:00Z', status: 'CANCELLED', fulfillmentLineItems: { nodes: [li('You Dress')] } },
    ],
  }
  const p = packagesFrom(order, '2026-09-10')
  assert.deepEqual(p.map((x) => [x.shippedOn, x.items[0].title]), [['2026-09-22', 'You Dress']])
  assert.equal(packagesFrom({ ...order, tags: ['Wholesale'] }, '2026-09-01').length, 0)
  assert.equal(packagesFrom({ ...order, cancelledAt: '2026-09-23T00:00:00Z' }, '2026-09-01').length, 0)
  // Dated in Los Angeles: 9 Oct 02:00 UTC is still 8 Oct there.
  const late = { ...order, fulfillments: [{ createdAt: '2026-10-09T02:00:00Z', status: 'SUCCESS', fulfillmentLineItems: { nodes: [li('Cleo Tee')] } }] }
  assert.equal(packagesFrom(late, '2026-10-01')[0].shippedOn, '2026-10-08')
})

test('deductions are dated by the day they are for, and only after the last count', () => {
  assert.equal(packingDay(`${PACKING_NOTE}2026-09-29: 1 order shipped.`), '2026-09-29')
  assert.equal(packingDay('Jane counted 1,500'), null)
  assert.deepEqual(daysBetween('2026-09-28', '2026-10-01'), ['2026-09-29', '2026-09-30', '2026-10-01'])
  assert.deepEqual(daysBetween('2026-10-01', '2026-10-01'), [])
})

test('the daily rate of a supply is over the days its deductions cover, not always 28', () => {
  const from = '2026-09-15', yesterday = '2026-10-12'
  assert.equal(coveredDays(from, yesterday, '2026-09-01'), 28, 'counted before the window: the whole window')
  assert.equal(coveredDays(from, yesterday, '2026-10-05'), 7, 'counted a week ago: the 7 days after the count')
  assert.equal(coveredDays(from, '2026-10-13', '2026-10-13'), 0, 'counted yesterday: nothing deducted yet')
  assert.equal(coveredDays(from, '2026-10-14', '2026-10-13'), 1, 'labels, counted 13 Oct: one day on the 15th')
  assert.equal(coveredDays(from, yesterday, null), 0, 'never counted')
  assert.equal(coveredDays(from, yesterday, '2026-09-14'), 28, 'counted the day before the window')
  assert.equal(dayBefore('2026-10-01'), '2026-09-30')
  assert.equal(dayBefore('2026-01-01'), '2025-12-31')
})
