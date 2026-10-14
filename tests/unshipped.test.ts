import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tallyUnshipped, type UnshippedOrder } from '../lib/shipped-report'

const order = (name: string, createdAt: string, items: UnshippedOrder['items'], extra: Partial<UnshippedOrder> = {}): UnshippedOrder =>
  ({ name, createdAt, cancelledAt: null, tags: [], items, ...extra })
const line = (title: string, variant: string | null, unfulfilled = 1, requiresShipping = true) => ({ title, variant, unfulfilled, requiresShipping })

const orders = [
  order('#2759', '2026-10-09T16:43:28Z', [line('Cleo Tee', 'Black / 1')]),
  order('#2763', '2026-10-09T20:57:41Z', [line('Cleo Tee', 'White / 2'), line('Cleo Tee', 'Black / 2')]),
  order('#2805', '2026-10-13T14:03:53Z', [line('Cleo Tee', 'Black / 1', 2), line('Cleo Tee - Splish', 'Splish / 1')]),
  order('#2261', '2026-09-01T21:57:25Z', [line('priority shipping', null, 1, false)]),
  order('#2900', '2026-10-01T00:00:00Z', [line('Cleo Tee', 'Black / 1')], { cancelledAt: '2026-10-02T00:00:00Z' }),
  order('#2901', '2026-10-01T00:00:00Z', [line('Cleo Tee', 'Black / 1', 6)], { tags: ['wholesale'] }),
  order('#2902', '2026-10-01T00:00:00Z', [line('Cleo Tee', 'Black / 3', 0)]),
]

test('counts units still waiting, by item, with orders and the oldest date', () => {
  const t = tallyUnshipped(orders)
  assert.equal(t.orders, 3)
  const black1 = t.lines.find((l) => l.item === 'Cleo Tee' && l.variant === 'Black / 1')!
  assert.deepEqual(black1, { item: 'Cleo Tee', variant: 'Black / 1', quantity: 3, orders: ['#2759', '#2805 ×2'], oldest: '2026-10-09' })
})

test('leaves out cancelled, wholesale, already-shipped units and lines that do not ship', () => {
  const t = tallyUnshipped(orders)
  const all = t.lines.flatMap((l) => l.orders)
  for (const n of ['#2261', '#2900', '#2901', '#2902']) assert.ok(!all.some((o) => o.startsWith(n)), n)
})

test('filters by whole product title and by colour or size', () => {
  assert.deepEqual(tallyUnshipped(orders, { item: 'Cleo Tee - Splish' }).lines.map((l) => l.variant), ['Splish / 1'])
  assert.equal(tallyUnshipped(orders, { item: 'Cleo Tee' }).lines.some((l) => l.item !== 'Cleo Tee'), false, '"Cleo Tee" is not "Cleo Tee - Splish"')
  assert.deepEqual(tallyUnshipped(orders, { item: 'Cleo Tee', variant: 'Black' }).lines.map((l) => [l.variant, l.quantity]), [['Black / 1', 3], ['Black / 2', 1]])
  assert.deepEqual(tallyUnshipped(orders, { variant: '2' }).lines.map((l) => l.variant), ['Black / 2', 'White / 2'])
})
