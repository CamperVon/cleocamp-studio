import { db } from '@/lib/db'
import { checkPnl, type PnlPull } from '@/lib/pnl-check'

/**
 * Record a nightly QuickBooks P&L pull — directly when it adds up, as a
 * question when it does not. See lib/pnl-check.ts for the rules and why this
 * replaced emailing the figures in for a person to confirm.
 *
 * Writes the same fields record_financials does, the same way: the typed
 * columns, plus YTD cost of goods, expenses and net income merged into
 * raw.pnl for the Finances page, never replacing what is already stored.
 */
export async function recordPnlPull(pull: PnlPull, source: string): Promise<
  | { recorded: true; asOfDate: string; warnings: string[] }
  | { recorded: false; asOfDate: string; problems: string[]; questionId: string | null }
> {
  // The last recorded year-to-date revenue, for the "did it fall off a cliff"
  // check — same calendar year only, since YTD starts again in January.
  const last = await db.financialSnapshot.findFirst({
    where: { revenueYtdCents: { not: null }, forDate: { lt: new Date(pull.asOfDate + 'T00:00:00Z') } },
    orderBy: { forDate: 'desc' },
    select: { forDate: true, revenueYtdCents: true },
  })
  const sameYear = last && last.forDate.toISOString().slice(0, 4) === pull.asOfDate.slice(0, 4)
  const lastRevenueYtd = sameYear && last.revenueYtdCents !== null ? Number(last.revenueYtdCents) / 100 : null

  const verdict = checkPnl(pull, lastRevenueYtd)

  if (!verdict.ok) {
    const title = `QuickBooks figures for ${pull.asOfDate} didn't add up — record them anyway?`
    // One question per night's figures, however many times the routine retries.
    const existing = await db.actionItem.findFirst({ where: { title, resolved: false }, select: { id: true } })
    const detail =
      `Not recorded, because: ${verdict.problems.join(' ')}\n\n` +
      `As pulled — month to date: revenue ${pull.mtd?.revenue}, cost of goods ${pull.mtd?.cogs}, ` +
      `gross profit ${pull.mtd?.grossProfit}, net operating income ${pull.mtd?.netOperatingIncome}, ` +
      `net income ${pull.mtd?.netIncome}. Year to date: revenue ${pull.ytd?.revenue}, cost of goods ` +
      `${pull.ytd?.cogs}, gross profit ${pull.ytd?.grossProfit}, net operating income ` +
      `${pull.ytd?.netOperatingIncome}, net income ${pull.ytd?.netIncome}. ` +
      `If they are right, say so and Mouse will record them with record_financials.`
    const q = existing ?? await db.actionItem.create({
      data: { kind: 'QUESTION', title, detail, source: 'SYSTEM' },
      select: { id: true },
    })
    return { recorded: false, asOfDate: pull.asOfDate, problems: verdict.problems, questionId: q.id }
  }

  const forDate = new Date(pull.asOfDate + 'T00:00:00Z')
  const c = (n: number) => BigInt(Math.round(n * 100))
  const prior = await db.financialSnapshot.findUnique({ where: { forDate }, select: { raw: true } })
  const priorRaw = (prior?.raw ?? {}) as Record<string, unknown>
  const priorPnl = (priorRaw.pnl ?? {}) as Record<string, unknown>
  const raw = {
    ...priorRaw,
    enteredBy: source,
    pulledAt: new Date().toISOString(),
    warnings: verdict.warnings,
    pnl: {
      ...priorPnl,
      expensesYtdCents: Math.round(verdict.expensesYtd * 100),
      cogsYtdCents: Math.round(pull.ytd.cogs * 100),
      netIncomeYtdCents: Math.round(pull.ytd.netIncome * 100),
      cogsMtdCents: Math.round(pull.mtd.cogs * 100),
      netIncomeMtdCents: Math.round(pull.mtd.netIncome * 100),
    },
  }
  const figures = {
    revenueMtdCents: c(pull.mtd.revenue),
    revenueYtdCents: c(pull.ytd.revenue),
    expensesMtdCents: c(verdict.expensesMtd),
    ...(typeof pull.receivables === 'number' ? { arCents: c(pull.receivables) } : {}),
  }
  await db.financialSnapshot.upsert({
    where: { forDate },
    create: { forDate, ...figures, raw: raw as never },
    update: { ...figures, raw: raw as never },
  })

  // A night that records cleanly answers any earlier "didn't add up" question
  // for the same day — a later, correct pull supersedes it.
  await db.actionItem.updateMany({
    where: { title: `QuickBooks figures for ${pull.asOfDate} didn't add up — record them anyway?`, resolved: false },
    data: { resolved: true, resolvedAt: new Date(), resolutionNote: 'A later pull for the same day added up and was recorded.' },
  })

  return { recorded: true, asOfDate: pull.asOfDate, warnings: verdict.warnings }
}
