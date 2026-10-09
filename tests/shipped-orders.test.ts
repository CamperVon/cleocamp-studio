import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labelRangeProblem, MAX_LABEL_DAYS, MAX_LABEL_LOOKBACK_DAYS, tallyShipped } from '../lib/shipped-report'
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

// Codex review, 8 Oct 2026: each look-up reads every order updated since its
// first day, so both the range and how far back it starts are capped before
// anything reaches Shopify.
const TODAY = '2026-10-08'

test('one look-up covers at most 31 days; a longer range is refused with the parts to ask in', () => {
  assert.equal(MAX_LABEL_DAYS, 31)
  assert.equal(labelRangeProblem('2026-10-07', '2026-10-07', TODAY), null)
  assert.equal(labelRangeProblem('2026-09-01', '2026-10-01', TODAY), null, '31 days, both ends counted')
  const p = labelRangeProblem('2026-09-01', '2026-10-02', TODAY)
  assert.match(p!, /That is 32 days; one look-up covers at most 31/)
  assert.match(p!, /2 parts.*2026-09-01 to 2026-10-01; 2026-10-02 to 2026-10-02/)
  const long = labelRangeProblem('2026-07-10', '2026-10-08', TODAY)!
  assert.match(long, /That is 91 days/)
  assert.match(long, /3 parts/)
  assert.match(labelRangeProblem('2026-02-30', '2026-03-01', TODAY) ?? '', /YYYY-MM-DD/, 'a day that does not exist')
})

test('a look-up starts no more than 90 days back, for now: even a one-day range', () => {
  assert.equal(MAX_LABEL_LOOKBACK_DAYS, 90)
  assert.equal(labelRangeProblem('2026-07-10', '2026-07-10', TODAY), null, 'exactly 90 days back is allowed')
  const p = labelRangeProblem('2026-07-09', '2026-07-09', TODAY)
  assert.match(p!, /reach back 90 days for now, to 2026-07-10/)
  assert.match(p!, /cannot be counted yet; that needs label history kept in the app/)
  assert.match(labelRangeProblem('2026-03-01', '2026-03-01', TODAY)!, /reach back 90 days/, 'a single day in March')
  // Across a year end, counted in calendar days.
  assert.equal(labelRangeProblem('2026-10-04', '2026-10-04', '2027-01-02'), null)
  assert.match(labelRangeProblem('2026-10-03', '2026-10-03', '2027-01-02')!, /to 2026-10-04/)
})

test('the label tool refuses before it would reach Shopify: a long range, and a start too far back', async () => {
  const day = (ago: number) => new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10)
  const range = await TOOLS.shipped_orders.run({ from: day(60), to: day(1) }) as Record<string, unknown>
  assert.equal(range.ok, false)
  assert.match(String(range.reason), /at most 31/)
  const old = await TOOLS.shipped_orders.run({ from: day(200), to: day(199) }) as Record<string, unknown>
  assert.equal(old.ok, false)
  assert.match(String(old.reason), /reach back 90 days/)
  // Within both limits it gets past the checks (here, to Shopify not being connected).
  const ok = await TOOLS.shipped_orders.run({ from: day(30), to: day(1) }) as Record<string, unknown>
  assert.doesNotMatch(String(ok.reason ?? ''), /at most 31|reach back|YYYY-MM-DD/)
})

test('the range check never bounds Shopify by updated_at: an order edited after its label still counts', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../lib/integrations/shopify.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export async function fetchShippedOrders'), src.indexOf('async function withRetry'))
  assert.match(fn, /updated_at:>=\$\{sinceDay\}/)
  assert.doesNotMatch(fn, /updated_at:<|updated_at:<=/)
})
