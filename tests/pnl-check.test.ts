import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPnl, type PnlPull } from '../lib/pnl-check'

// Cleo Couture's real YTD shape from 12 Sept 2026 (CLAUDE.md §6): gross profit
// 254,193.71, net operating income 216,179.49, so expenses 38,014.22.
const good = (): PnlPull => ({
  asOfDate: '2026-09-12',
  mtd: { revenue: 30000, cogs: 5378.04, grossProfit: 24621.96, netOperatingIncome: 23921.96, netIncome: 23900, expensesGroupTotal: 700 },
  ytd: { revenue: 297416, cogs: 43222.29, grossProfit: 254193.71, netOperatingIncome: 216179.49, netIncome: 216114.12, expensesGroupTotal: 38014.22 },
  receivables: 0,
})

test('a pull that adds up is accepted, with expenses from the identity', () => {
  const v = checkPnl(good(), 290000)
  assert.equal(v.ok, true)
  if (v.ok) assert.ok(Math.abs(v.expensesYtd - 38014.22) < 0.01)
})

test('never uses a net income figure in place of net operating income', () => {
  // summaryBreakdown.netOperatingIncome held net INCOME (216,114.12), which
  // gives expenses of 38,079.59 — wrong by $65.37. The line sum catches it.
  const p = good(); p.ytd.netOperatingIncome = 216114.12
  const v = checkPnl(p, null)
  assert.equal(v.ok, false)
})

test('double-counted cost of goods is refused', () => {
  // 15 Sept: monthlyBreakdown gave COGS $8,290.03 against a true $5,378.04.
  const p = good(); p.mtd.cogs = 8290.03
  const v = checkPnl(p, null)
  assert.equal(v.ok, false)
  if (!v.ok) assert.match(v.problems.join(' '), /double-counted/)
})

test('an expenses figure that counts total rows twice is refused', () => {
  const p = good(); p.ytd.expensesGroupTotal = 509415.23
  const v = checkPnl(p, null)
  assert.equal(v.ok, false)
  if (!v.ok) assert.match(v.problems.join(' '), /counted twice/)
})

test('no line sum is allowed, but said out loud', () => {
  const p = good(); p.ytd.expensesGroupTotal = null
  const v = checkPnl(p, null)
  assert.equal(v.ok, true)
  if (v.ok) assert.match(v.warnings.join(' '), /not cross-checked/)
})

test('month to date above year to date is refused', () => {
  const p = good(); p.mtd.revenue = 400000; p.mtd.grossProfit = 400000 - p.mtd.cogs
  assert.equal(checkPnl(p, null).ok, false)
})

test('a year-to-date revenue cliff is refused, a small correction is not', () => {
  assert.equal(checkPnl(good(), 340000).ok, false, '297k after 340k — too big a drop')
  assert.equal(checkPnl(good(), 300000).ok, true, 'a 1% correction is ordinary bookkeeping')
})

test('missing fields are refused rather than recorded as zero', () => {
  const p = good() as unknown as { ytd: Record<string, unknown> }
  delete p.ytd.netIncome
  assert.equal(checkPnl(p as unknown as PnlPull, null).ok, false)
})
