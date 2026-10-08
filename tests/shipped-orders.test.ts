import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tallyShipped } from '../lib/shipped-report'
import { packagesFrom, type ShippedOrder } from '../lib/integrations/shopify'
import { TOOLS } from '../lib/mouse/tools'

// Labels by day (Jane, 8 Oct 2026): how many Black Cleo Tees were in the
// orders she bought Shopify labels for on 7 Oct. Mouse could not say.

const pk = (name: string, shippedOn: string, items: Array<[string, string | null, number]>): ShippedOrder =>
  ({ name, shippedOn, items: items.map(([title, variant, quantity]) => ({ variantId: '', title, variant, quantity })) })
const packages = [
  pk('#1', '2026-10-07', [['Cleo Tee', 'Black / 1', 1], ['Cleo Tee - Splish', 'Splish / 1', 1]]),
  pk('#2', '2026-10-07', [['Cleo Tee', 'Black / 3', 2]]),
  pk('#3', '2026-10-07', [['Cleo Tee', 'White / 1', 1]]),
  pk('#4', '2026-10-06', [['Cleo Tee', 'Black / 1', 1]]),
  pk('#5', '2026-10-08', [['Cleo Tee', 'Black / 2', 1]]),
]

test('labels made on a day, one product and colour, by size with the orders', () => {
  const t = tallyShipped(packages, { from: '2026-10-07', to: '2026-10-07', item: 'Cleo Tee', variant: 'Black' })
  assert.equal(t.orders, 2)
  assert.equal(t.packages, 3, 'every package that day')
  assert.deepEqual(t.lines.map((l) => [l.variant, l.quantity, l.orders]), [['Black / 1', 1, ['#1']], ['Black / 3', 2, ['#2 ×2']]])
})

test('an exact product title: "Cleo Tee" never counts the Splish tee; a range covers its days', () => {
  const t = tallyShipped(packages, { from: '2026-10-06', to: '2026-10-08', item: 'cleo tee' })
  assert.ok(t.lines.every((l) => l.item === 'Cleo Tee'))
  assert.equal(t.lines.reduce((n, l) => n + l.quantity, 0), 6)
  assert.equal(tallyShipped(packages, { from: '2026-10-07', to: '2026-10-07', variant: 'Black / 3' }).lines[0].quantity, 2)
})

test('shipped packages carry the variant name', () => {
  const p = packagesFrom({
    name: '#7', cancelledAt: null, tags: [],
    fulfillments: [{ createdAt: '2026-10-07T22:02:53Z', status: 'SUCCESS', fulfillmentLineItems: { nodes: [{ quantity: 1, lineItem: { title: 'Cleo Tee', variantTitle: 'Black / 2', requiresShipping: true, variant: { id: 'v1' } } }] } }],
  }, '2026-10-07')
  assert.equal(p[0].items[0].variant, 'Black / 2')
})

test('the label tool refuses a bad date before reaching Shopify', async () => {
  const r = await TOOLS.shipped_orders.run({ from: '7 Oct' }) as Record<string, unknown>
  assert.equal(r.ok, false)
  assert.match(String(r.reason), /YYYY-MM-DD/)
  assert.equal((await TOOLS.shipped_orders.run({ from: '2026-10-08', to: '2026-10-07' }) as Record<string, unknown>).ok, false)
})
