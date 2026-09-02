import { db } from '@/lib/db'
import { Page, Card, Empty, Stat } from '@/app/ui/primitives'
import { isConfigured } from '@/lib/integrations/quickbooks'
import { paymentStages } from '@/lib/payments'

export const dynamic = 'force-dynamic'

const money = (c: bigint | null | undefined) =>
  c === null || c === undefined
    ? '—'
    : (Number(c) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default async function Finances() {
  const [conn, snap, pos] = await Promise.all([
    db.quickBooksConnection.findUnique({ where: { id: 'singleton' } }),
    db.financialSnapshot.findFirst({ orderBy: { forDate: 'desc' } }),
    db.purchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { vendor: true, lines: { include: { component: true } } },
    }),
  ])
  const open = pos.filter((p) => p.status === 'SENT' || p.status === 'PARTIALLY_RECEIVED')
  const invoices = ((snap?.raw as any)?.invoices ?? []) as Array<{
    number: string; customer: string; date: string; total: number; balance: number
  }>

  const committed = pos
    .filter((p) => p.status === 'SENT' || p.status === 'PARTIALLY_RECEIVED')
    .reduce((n, p) => n + p.lines.reduce((m, l) => m + Number(l.qtyOrdered) * (l.unitCostCents ?? 0), 0), 0)

  // Figures can arrive by hand long before the Intuit connection exists — the
  // page should show what it has rather than insisting on OAuth first.
  if (!conn && !snap) {
    return (
      <Page title="Finances" lede="Where the money is, what is committed, and what is owed.">
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
          <div className="flex flex-wrap gap-3">
            <Stat label="Committed" value={money(BigInt(committed))} sub="open purchase orders" />
            <Stat label="Open POs" value={open.length} sub="awaiting delivery" />
          </div>



          <Card title={`Open purchase orders (${open.length})`}>
            {open.length === 0 ? (
              <Empty>Nothing outstanding.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {open.map((p) => {
                  const total = p.lines.reduce((m, l) => m + Number(l.qtyOrdered) * (l.unitCostCents ?? 0), 0)
                  const stages = paymentStages(p, total)
                  return (
                    <li key={p.id} className="px-4 py-3.5 sm:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            <a href={`/po/${p.poNumber}`} target="_blank" rel="noreferrer" className="hover:underline">
                              PO {p.poNumber} &middot; {p.vendor.name} &nearr;
                            </a>
                          </p>
                          <p className="truncate text-xs text-muted">
                            {p.lines.map((l) => `${l.qtyOrdered} ${l.unit} ${l.component.name}`).join(', ')}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="tnum text-sm">{money(BigInt(total))}</p>
                          <p className="text-xs text-faint">{p.paymentTerms ?? 'terms not recorded'}</p>
                        </div>
                      </div>
                      <ul className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
                        {stages.map((s, i) => (
                          <li key={i} className="flex justify-between gap-3 text-xs">
                            <span className="text-muted">{s.label}</span>
                            <span className="shrink-0">
                              <span className="tnum">{money(BigInt(s.amountCents))}</span>
                              <span className={s.overdue ? ' text-urgent' : ' text-faint'}> &middot; {s.due}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

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
