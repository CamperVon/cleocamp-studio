/**
 * Does a QuickBooks P&L pull add up well enough to record without a person
 * looking at it first? Pure — no database — so every rule here is tested.
 *
 * Brandon, 23 Sept 2026: fix the nightly QuickBooks pull so it lands
 * "without having to approve." Until then every pull arrived as an email a
 * person had to confirm, and in practice nobody did: five pulls came in
 * between 15 and 20 Sept and one was recorded, by hand. The approval step was
 * there because this report has fooled us before — the "double accounting"
 * Brandon remembers — and a wrong number on the Finances page is worse than a
 * missing one (CLAUDE.md §3). So the judgement a person was being asked to
 * make is made here, in code, on every pull:
 *
 *  - Gross profit must equal revenue less cost of goods. On 15 Sept the
 *    report's monthlyBreakdown gave COGS as $8,290.03 against a true
 *    $5,378.04 — "Total for X" rows counted alongside the rows they total.
 *  - Expenses are gross profit less net operating income, never QuickBooks'
 *    own "Total Expenses", which reads $0.00 on these books (CLAUDE.md §6).
 *    The report's own Expenses group total must agree with that — never a
 *    sum of the lines, which once gave $509,415.23 against a true $38,014.22.
 *  - Month to date cannot exceed year to date.
 *  - Year-to-date revenue does not fall by more than a few percent from the
 *    last recorded figure — books get corrected, but not by that much
 *    overnight.
 *
 * Anything that fails is not written. It becomes a question with the figures
 * and the reason attached, which is exactly the old proposal flow — kept for
 * the nights it is actually needed, rather than every night.
 */

export type PnlPeriod = {
  revenue: number
  cogs: number
  grossProfit: number
  /** The report's own labelled "Net Operating Income" row — NOT summaryBreakdown.netOperatingIncome, which is net income. */
  netOperatingIncome: number
  netIncome: number
  /**
   * The report's own "Expenses" group total row. Optional; checked when given.
   * NOT a sum of the expense lines — a group can carry an amount of its own
   * (on these books $10.36 sits on "Auto Expenses" itself, above its three
   * sub-accounts), so summing the lines comes out short, and summing lines
   * plus "Total for X" rows comes out double.
   */
  expensesGroupTotal?: number | null
}

export type PnlPull = {
  /** The Pacific day the figures describe, YYYY-MM-DD. */
  asOfDate: string
  mtd: PnlPeriod
  ytd: PnlPeriod
  receivables?: number | null
}

export type PnlVerdict =
  | { ok: true; expensesMtd: number; expensesYtd: number; warnings: string[] }
  | { ok: false; problems: string[] }

/**
 * A dollar either way, for rounding and nothing more. These are identities
 * that hold to the cent on a correct report — CLAUDE.md §6: "Gross Profit −
 * Net Operating Income is exact". A percentage tolerance was tried first and
 * waved through the $65.37 error that taking net income for net operating
 * income produces; half a percent of $38k is $190.
 */
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function checkPnl(pull: PnlPull, lastRevenueYtd: number | null): PnlVerdict {
  const problems: string[] = []
  const warnings: string[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pull.asOfDate ?? '')) problems.push('asOfDate must be YYYY-MM-DD.')

  const fields: Array<keyof PnlPeriod> = ['revenue', 'cogs', 'grossProfit', 'netOperatingIncome', 'netIncome']
  for (const [label, p] of [['month to date', pull.mtd], ['year to date', pull.ytd]] as const) {
    if (!p) { problems.push(`No ${label} figures.`); continue }
    const missing = fields.filter((f) => typeof p[f] !== 'number' || !Number.isFinite(p[f] as number))
    if (missing.length) { problems.push(`${label}: missing ${missing.join(', ')}.`); continue }
    if (p.revenue < 0) problems.push(`${label}: revenue is negative (${money(p.revenue)}).`)
    if (!close(p.revenue - p.cogs, p.grossProfit)) {
      problems.push(
        `${label}: revenue ${money(p.revenue)} less cost of goods ${money(p.cogs)} is ` +
          `${money(p.revenue - p.cogs)}, but gross profit reads ${money(p.grossProfit)} — ` +
          `cost of goods is probably double-counted.`,
      )
    }
    const expenses = p.grossProfit - p.netOperatingIncome
    if (expenses < 0) problems.push(`${label}: expenses come out negative (${money(expenses)}).`)
    if (p.expensesGroupTotal === null || p.expensesGroupTotal === undefined) {
      warnings.push(`${label}: expenses not cross-checked against the report's Expenses total.`)
    } else if (!close(expenses, p.expensesGroupTotal)) {
      problems.push(
        `${label}: expenses are ${money(expenses)} by gross profit less net operating income, ` +
          `but the report's Expenses total is ${money(p.expensesGroupTotal)} — the wrong row ` +
          `was probably read, or a total row is being counted twice.`,
      )
    }
  }
  if (problems.length) return { ok: false, problems }

  if (pull.mtd.revenue > pull.ytd.revenue + 1) {
    problems.push(`Month-to-date revenue ${money(pull.mtd.revenue)} is more than year to date ${money(pull.ytd.revenue)}.`)
  }
  const expensesMtd = pull.mtd.grossProfit - pull.mtd.netOperatingIncome
  const expensesYtd = pull.ytd.grossProfit - pull.ytd.netOperatingIncome
  if (expensesMtd > expensesYtd + 1) {
    problems.push(`Month-to-date expenses ${money(expensesMtd)} are more than year to date ${money(expensesYtd)}.`)
  }
  if (lastRevenueYtd !== null && lastRevenueYtd > 0 && pull.ytd.revenue < lastRevenueYtd * 0.95) {
    problems.push(
      `Year-to-date revenue ${money(pull.ytd.revenue)} is more than 5% below the last recorded ` +
        `${money(lastRevenueYtd)}. Books get corrected, but not usually by that much overnight.`,
    )
  }
  if (problems.length) return { ok: false, problems }

  return { ok: true, expensesMtd, expensesYtd, warnings }
}
