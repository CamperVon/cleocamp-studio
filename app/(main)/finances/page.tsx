import { db } from '@/lib/db'
import { Page, Card, Empty, Stat, Chip } from '@/app/ui/primitives'
import { isConfigured } from '@/lib/integrations/quickbooks'
import { laMidnight } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const money = (c: bigint | null | undefined) =>
  c === null || c === undefined
    ? '—'
    : (Number(c) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default async function Finances() {
  const [conn, snap] = await Promise.all([
    db.quickBooksConnection.findUnique({ where: { id: 'singleton' } }),
    db.financialSnapshot.findFirst({ orderBy: { forDate: 'desc' } }),
  ])
  const raw = (snap?.raw ?? {}) as {
    source?: string
    note?: string
    warnings?: string[]
    pnl?: { expensesYtdCents?: number; cogsYtdCents?: number; netIncomeYtdCents?: number }
  }
  const warnings = raw.warnings ?? []
  // Receivables and the Invoices card were both removed 15 Sept 2026 —
  // receivables reads $0 because wholesale isn't invoiced through QuickBooks
  // at all, and `raw.invoices` has never once been populated by anything, so
  // the card only ever rendered an empty state explaining a number that is
  // no longer shown. Two pieces of furniture for a room nobody uses.
  //
  // Cash intentionally dropped, 14 Sept 2026: the QuickBooks connector has no
  // API for the live bank-feed balance (only the reconciled ledger), which
  // read tens of thousands off the real bank balance during bookkeeping
  // catch-up. Rather than show a number that's wrong in a way nobody can fix
  // from here, this page shows P&L instead — revenue and expenses aren't
  // subject to that same bank-feed-vs-ledger gap. See HANDOFF.md.
  //
  // expensesYtdCents has no typed column yet (this session can't run a
  // migration — no direct DB connection available from here) so it rides in
  // raw.pnl as a stopgap. Promote it to a real FinancialSnapshot column next
  // time someone has local/DIRECT_URL access.
  const bigOrNull = (n: number | undefined) => (typeof n === 'number' ? BigInt(n) : null)
  const expensesYtdCents = bigOrNull(raw.pnl?.expensesYtdCents)
  const cogsYtdCents = bigOrNull(raw.pnl?.cogsYtdCents)

  // Net income is REPORTED, not inferred.
  //
  // This used to be revenue minus operating expenses, which silently left cost
  // of goods out of the subtraction entirely. On 21 Sept 2026 that put $274,480
  // on screen against a true $231,974.80 — overstated by the whole $42,505 of
  // COGS, every day since the page moved to P&L on the 14th. The figure looked
  // plausible, the arithmetic was consistent, and nothing could have caught it
  // except checking it against the P&L, because the page was never given the
  // numbers the real formula needs.
  //
  // So take the reported figure when there is one. Fall back to deriving it
  // only with cost of goods in hand, and otherwise show nothing at all — a
  // dash is a worse experience and a better number than a confident wrong one.
  const netIncomeYtdCents =
    bigOrNull(raw.pnl?.netIncomeYtdCents) ??
    (snap?.revenueYtdCents != null && expensesYtdCents != null && cogsYtdCents != null
      ? snap.revenueYtdCents - cogsYtdCents - expensesYtdCents
      : null)

  // How old is the figure actually on screen?
  //
  // The nightly pull runs at 7pm Pacific, so a figure dated yesterday is normal
  // by morning and two days old is not. On 21 Sept 2026 this page was showing
  // the 14th — six days, $16,558 of revenue behind QuickBooks — because three
  // nights of figures were approved and never written (see resolve_item in
  // lib/mouse/tools.ts). The date was on screen the whole time, in the lede,
  // phrased as ordinary context rather than as a problem. Nobody reads a
  // caption that has always been there.
  //
  // Both sides are UTC midnight of a Pacific day, so this subtracts to whole
  // days without re-entering a timezone. Do not reformat laMidnight's output
  // through another Pacific formatter; that double-converts.
  const daysOld =
    snap != null
      ? Math.round((laMidnight(0).getTime() - snap.forDate.getTime()) / 86_400_000)
      : null
  const stale = daysOld != null && daysOld >= 2

  // Figures can arrive by hand long before the Intuit connection exists — the
  // page should show what it has rather than insisting on OAuth first.
  if (!conn && !snap) {
    return (
      <Page title="Finances" lede="Where the money is and what is owed to Cleo Camp. Purchase order commitments live on the Purchase orders tab.">
        <Card title="Nothing recorded yet">
          <div className="flex flex-col gap-3 px-4 py-5 sm:px-5">
            <p className="text-sm text-muted">
              Tell Studio Mouse where things stand and it will keep track &mdash;
              &ldquo;revenue this year is $200,000 and expenses are $150,000&rdquo;,
              or paste a QuickBooks summary. No setup needed.
            </p>
            <p className="text-sm text-muted">
              {isConfigured()
                ? 'Ready to connect. You will be sent to Intuit to authorise, once.'
                : 'Set QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI first, then come back.'}
            </p>
            {isConfigured() ? (
              <a href="/api/quickbooks/connect"
                className="self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white dark:text-[#0F1211]">
                Connect QuickBooks
              </a>
            ) : null}
          </div>
        </Card>
      </Page>
    )
  }

  return (
    <Page
      title="Profit &amp; Loss"
      lede={
        snap
          ? `Year to date, as of ${snap.forDate.toLocaleDateString('en-US', {
              timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
            })}.`
          : 'Nothing recorded yet.'
      }
    >
      <a
        href="https://qbo.intuit.com/app/homepage"
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:bg-sunk sm:px-5"
      >
        <span className="text-sm font-medium">Open QuickBooks</span>
        <span className="text-xs text-faint">qbo.intuit.com &nearr;</span>
      </a>
      {conn?.lastError ? (
        <div className="rounded-xl border border-urgent bg-urgent-soft px-4 py-3 text-sm text-urgent sm:px-5">
          <p className="font-medium">The last refresh failed.</p>
          <p className="mt-1">{conn?.lastError}</p>
          <p className="mt-1">
            If this persists, reconnect — Intuit refresh tokens die after 100 days unused.
          </p>
        </div>
      ) : null}

      {stale ? (
        <div className="rounded-xl border border-urgent bg-urgent-soft px-4 py-3 text-sm text-urgent sm:px-5">
          <p className="font-medium">
            These figures are {daysOld} days old. They are not today&rsquo;s.
          </p>
          <p className="mt-1">
            QuickBooks is pulled every night, so something has stopped being recorded.
            Ask Mouse to record the latest figures — there is usually a question waiting
            in Things to tend to.
          </p>
        </div>
      ) : null}

      {snap ? (
        <>
          <Card title="Year to date">
            <div className="flex flex-wrap gap-3 px-4 py-4 sm:px-5">
              <Stat label="Revenue" value={money(snap.revenueYtdCents)} />
              {/* Cost of goods earns its place: without it on screen, revenue
                  minus expenses does not come to net income and the page looks
                  like it has made an arithmetic error. It is also the figure
                  whose absence caused the overstatement described above. */}
              <Stat label="Cost of goods" value={money(cogsYtdCents)} />
              <Stat label="Expenses" value={money(expensesYtdCents)} />
              <Stat label="Net income" value={money(netIncomeYtdCents)} />
            </div>
            {snap.revenueMtdCents !== null || snap.expensesMtdCents !== null ? (
              <div className="flex flex-wrap gap-3 border-t border-line px-4 py-4 sm:px-5">
                {snap.revenueMtdCents !== null ? <Stat label="Revenue, month to date" value={money(snap.revenueMtdCents)} /> : null}
                {snap.expensesMtdCents !== null ? <Stat label="Expenses, month to date" value={money(snap.expensesMtdCents)} /> : null}
              </div>
            ) : null}
            {/* Expenses YTD comes from Gross Profit − Net Operating Income
                (QuickBooks' own "Total Expenses" reads $0.00 due to a known
                trend-calculation bug — see lib/integrations/quickbooks.ts and
                CLAUDE.md's "Things that have already caught us out"),
                cross-checked against summed line items. Disagreements between
                the two methods land in `warnings` below rather than being
                silently resolved. */}
            {warnings.length ? (
              <ul className="border-t border-line px-4 py-3 sm:px-5">
                {warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-warn">
                    <Chip tone="warn">check</Chip>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </>
      ) : (
        <Empty>Connected, but nothing pulled yet. The nightly job will fetch it.</Empty>
      )}
    </Page>
  )
}
