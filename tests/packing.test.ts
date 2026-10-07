import assert from 'node:assert/strict'
import test from 'node:test'
import { daysBetween, packingDay, packingFor, packingForOrders, PACKING_NOTE } from '../lib/packing'
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

test('every package gets a postcard and a 25th of a roll of tape', () => {
  const t = packingForOrders(Array.from({ length: 25 }, () => ({ items: [one('Cleo Tee')] })))
  assert.equal(t.postcard, 25)
  assert.ok(Math.abs(t.tape - 1) < 1e-9)
  assert.equal(packingFor([]).postcard, 0)
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
