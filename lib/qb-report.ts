import type { PnlPeriod } from '@/lib/pnl-check'

/**
 * Read a P&L period straight out of the Intuit QuickBooks connector's
 * profit_loss_quickbooks_account result — the whole JSON, as returned.
 *
 * Only the report's own top-level rows are read (parentId "0"), by name:
 * Income, Cost of Goods Sold, Gross Profit, Expenses, Net Operating Income,
 * Net Income, each from DETAIL_NATURAL_HOME_AMOUNT__TOTAL. Nothing is summed.
 * Every way this report has misled us came from adding things up or from its
 * convenience fields, so none of those are touched:
 *
 *  - totalExpenses reads 0 (CLAUDE.md §6)
 *  - summaryBreakdown.netOperatingIncome is actually net income
 *  - monthlyBreakdown.totalCogs double-counts: on 22 Sept it said $26,474.36
 *    against a true $19,059.03 for the same month
 *  - a group can hold an amount of its own above its sub-accounts, and
 *    "Total for X" rows sit beside the rows they total, so any line sum is
 *    either short or double
 *
 * Then lib/pnl-check.ts checks the six against each other.
 */

type Cell = { name?: string; value?: unknown }
type Row = { metadata?: { parentId?: string }; cells?: Cell[] }

export function pnlFromConnectorReport(report: unknown): PnlPeriod {
  const rows = (report as { reportData?: { data?: { rows?: Row[] } } })?.reportData?.data?.rows
  if (!Array.isArray(rows)) throw new Error('Not a QuickBooks P&L report: no reportData.data.rows.')

  const top = new Map<string, number>()
  for (const r of rows) {
    if (r.metadata?.parentId !== '0') continue
    const name = r.cells?.find((c) => c.name === 'ACCOUNT_NAME')?.value
    const total = r.cells?.find((c) => c.name === 'DETAIL_NATURAL_HOME_AMOUNT__TOTAL')?.value
    if (typeof name === 'string' && typeof total === 'number') top.set(name.trim().toLowerCase(), total)
  }

  const need = (label: string) => {
    const v = top.get(label.toLowerCase())
    if (v === undefined) throw new Error(`QuickBooks report has no top-level "${label}" row.`)
    return v
  }
  // A period with no purchases or no expenses has no such section at all —
  // that is a genuine zero, unlike a missing Income or Net Income row.
  const optional = (label: string) => top.get(label.toLowerCase()) ?? 0

  return {
    revenue: need('Income'),
    cogs: optional('Cost of Goods Sold'),
    grossProfit: need('Gross Profit'),
    netOperatingIncome: need('Net Operating Income'),
    netIncome: need('Net Income'),
    expensesGroupTotal: optional('Expenses'),
  }
}
