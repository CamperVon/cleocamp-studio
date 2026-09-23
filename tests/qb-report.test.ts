import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pnlFromConnectorReport } from '../lib/qb-report'
import { checkPnl } from '../lib/pnl-check'

// Shaped exactly like the connector's result for 1-22 Sept 2026, trimmed to
// the rows that matter, with the real figures and the real traps left in.
const row = (id: string, parentId: string, name: string | null, total: number, own = total) => ({
  metadata: { id, parentId },
  cells: [
    { name: 'ACCOUNT_NAME', value: name },
    { name: 'DETAIL_NATURAL_HOME_AMOUNT__TOTAL', value: total },
    { name: 'DETAIL_NATURAL_HOME_AMOUNT__TOTAL_WITHOUT_SUBGROUPS', value: own },
  ],
})
const september = {
  totalExpenses: 0, // the bug
  summaryBreakdown: { netOperatingIncome: 25309.92 },
  monthlyBreakdown: { '2026-09-01 - 2026-09-30': { totalCogs: 26474.36 } }, // the double count
  reportData: { data: { rows: [
    row('1', '0', 'Income', 50768.5, 0),
    row('1.2', '1', 'Sales', 50732.52),
    row('2', '0', 'Cost of Goods Sold', 19059.03, 0),
    row('2.6', '2', 'Manufacturing', 4502.5, 4052.5), // a group with money of its own
    row('2.6.1', '2.6', 'Cleo Tee', 450),
    row('2.6.2', '2.6', 'Total for Manufacturing', 4502.5), // sibling total
    row('3', '0', 'Gross Profit', 31709.47),
    row('4', '0', 'Expenses', 6399.55, 0),
    row('4.1', '4', 'Advertising & Marketing', 2500),
    row('5', '0', 'Net Operating Income', 25309.92),
    row('6', '0', 'Net Income', 25309.92),
  ] } },
}

test('reads the top-level rows, and none of the convenience fields', () => {
  const p = pnlFromConnectorReport(september)
  assert.equal(p.revenue, 50768.5)
  assert.equal(p.cogs, 19059.03, 'the report row, not monthlyBreakdown.totalCogs 26,474.36')
  assert.equal(p.grossProfit, 31709.47)
  assert.equal(p.netOperatingIncome, 25309.92)
  assert.equal(p.expensesGroupTotal, 6399.55, 'the Expenses row, not totalExpenses 0')
})

test('the real September figures pass the checks', () => {
  const p = pnlFromConnectorReport(september)
  const v = checkPnl({ asOfDate: '2026-09-22', mtd: p, ytd: { ...p, revenue: 324398.02, cogs: 94742.59, grossProfit: 229655.43, netOperatingIncome: 176535.15, netIncome: 176469.78, expensesGroupTotal: 53120.28 } }, null)
  assert.equal(v.ok, true)
  if (v.ok) assert.ok(Math.abs(v.expensesMtd - 6399.55) < 0.01)
})

test('no expenses or no purchases in a period is a real zero', () => {
  const quiet = { reportData: { data: { rows: [
    row('1', '0', 'Income', 100), row('3', '0', 'Gross Profit', 100),
    row('5', '0', 'Net Operating Income', 100), row('6', '0', 'Net Income', 100),
  ] } } }
  const p = pnlFromConnectorReport(quiet)
  assert.equal(p.cogs, 0)
  assert.equal(p.expensesGroupTotal, 0)
})

test('a report missing a row it must have is refused, not read as zero', () => {
  const broken = { reportData: { data: { rows: [row('1', '0', 'Income', 100)] } } }
  assert.throws(() => pnlFromConnectorReport(broken), /Gross Profit/)
  assert.throws(() => pnlFromConnectorReport({ status: 'error' }), /Not a QuickBooks P&L report/)
})
