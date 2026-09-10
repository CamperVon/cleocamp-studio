import { db } from '@/lib/db'
import { Page, Card, Empty } from '@/app/ui/primitives'
import { isConfigured } from '@/lib/integrations/quickbooks'

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
  const invoices = ((snap?.raw as any)?.invoices ?? []) as Array<{
    number: string; customer: string; date: string; total: number; balance: number
  }>

  // Figures can arrive by hand long before the Intuit connection exists — the
  // page should show what it has rather than insisting on OAuth first.
  if (!conn && !snap) {
    return (
      <Page title="Finances" lede="Where the money is and what is owed to Cleo Camp. Purchase order commitments live on the Purchase orders tab.">
        <Card title="Nothing recorded yet">
          <div className="flex flex-col gap-3 px-4 py-5 sm:px-5">
            <p className="text-sm text-muted">
              Tell Studio Mouse where things stand and it will keep track &mdash;
              &ldquo;as of today we have $40,000 in the bank and $12,000 outstanding&rdquo;,
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
      title="Cash"
      lede={
        snap
          ? `From QuickBooks, ${snap.forDate.toLocaleDateString('en-US', {
              timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
            })}. Pulled nightly at 7pm.`
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

      {snap ? (
        <>
          <Card title="Invoices">
            {invoices.length === 0 ? (
              <Empty>
                None recorded. Wholesale is not currently invoiced through QuickBooks &mdash;
                that is why receivables read zero.
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {invoices.map((v, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{v.customer}</p>
                      <p className="text-xs text-muted">#{v.number} &middot; {v.date}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tnum text-sm">
                        {v.total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                      </p>
                      <p className={'text-xs ' + (v.balance > 0 ? 'text-warn' : 'text-faint')}>
                        {v.balance > 0
                          ? v.balance.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) + ' due'
                          : 'paid'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

        </>
      ) : (
        <Empty>Connected, but nothing pulled yet. The nightly job will fetch it.</Empty>
      )}
    </Page>
  )
}
