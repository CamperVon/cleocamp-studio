import { readFileSync } from 'node:fs'
import { recordPnlPull } from '@/lib/record-pnl'
import { pnlFromConnectorReport } from '@/lib/qb-report'
import type { PnlPeriod } from '@/lib/pnl-check'

/**
 * What the nightly QuickBooks routine runs, in place of emailing the figures
 * in for someone to confirm.
 *
 *   npx tsx scripts/record-quickbooks.ts \
 *     --ytd /path/to/ytd-report.json --mtd /path/to/mtd-report.json \
 *     [--receivables 0] [--as-of 2026-09-22]
 *
 * --as-of defaults to today in Los Angeles, so the routine never has to work
 * out a date itself (or run a shell command to do it).
 *
 * Each report file is the Intuit connector's profit_loss_quickbooks_account
 * result, whole and unedited (or, for a short inline one, its six top-level
 * rows — see read() below) — the routine does no reading or arithmetic of
 * its own, which is where the double counting used to come in. This script
 * reads the report's own top-level rows (lib/qb-report.ts), checks them
 * against each other (lib/pnl-check.ts), and records them if they add up or
 * raises a question if they do not (lib/record-pnl.ts).
 *
 * Exits 0 whenever the pull was dealt with, recorded or questioned. Exits 1
 * only when it could not run: a missing file, a report that is not a P&L.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const asOfDate = arg('as-of') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const ytdPath = arg('ytd')
  const mtdPath = arg('mtd')
  if (!ytdPath || !mtdPath) {
    throw new Error('Usage: --ytd <report.json> --mtd <report.json> [--receivables N] [--as-of YYYY-MM-DD]')
  }
  // A report the connector returned in full (usually saved to a file for the
  // routine, because it is large) is read by pnlFromConnectorReport. A short
  // one that came back inline can instead be passed as just its six
  // top-level rows — { revenue, cogs, grossProfit, expenses,
  // netOperatingIncome, netIncome } — copied from the rows with those names,
  // which saves copying the whole report out by hand. Either way the checks
  // that follow are the same, and a misread row fails them.
  const read = (p: string): PnlPeriod => {
    const json = JSON.parse(readFileSync(p, 'utf8'))
    if (json && typeof json === 'object' && 'reportData' in json) return pnlFromConnectorReport(json)
    return {
      revenue: json.revenue, cogs: json.cogs, grossProfit: json.grossProfit,
      netOperatingIncome: json.netOperatingIncome, netIncome: json.netIncome,
      expensesGroupTotal: json.expenses ?? null,
    }
  }
  const receivablesArg = arg('receivables')
  const receivables = receivablesArg === undefined ? null : Number(receivablesArg)

  const result = await recordPnlPull(
    { asOfDate, ytd: read(ytdPath), mtd: read(mtdPath), receivables: Number.isFinite(receivables) ? receivables : null },
    'nightly QuickBooks routine',
  )
  console.log(JSON.stringify(result, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
