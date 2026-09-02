import { db } from '@/lib/db'
import { Page, Card, Empty, Stat } from '@/app/ui/primitives'
import { isConfigured } from '@/lib/integrations/quickbooks'

export const dynamic = 'force-dynamic'

const money = (c: bigint | null | undefined) =>
  c === null || c === undefined
    ? '—'
    : (Number(c) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default async function Cash() {
  const [conn, snap, pos] = await Promise.all([
    db.quickBooksConnection.findUnique({ where: { id: 'singleton' } }),
    db.financialSnapshot.findFirst({ orderBy: { forDate: 'desc' } }),
    db.purchaseOrder.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } },
      include: { vendor: true, lines: true },
    }),
  ])

  const committed = pos.reduce(
    (n, p) => n + p.lines.reduce((m, l) => m + Number(l.qtyOrdered) * (l.unitCostCents ?? 0), 0), 0)

  // Figures can arrive by hand long before the Intuit connection exists — the
  // page should show what it has rather than insisting on OAuth first.
  if (!conn && !snap) {
    return (
      <Page title="Cash" lede="Balances, receivables and revenue from QuickBooks.">
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
          ? `As of ${snap.forDate.toISOString().slice(0, 10)}${conn ? ', from QuickBooks.' : ', entered by hand.'}`
          : 'Connected. Waiting for the first pull.'
      }
    >
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
            <Stat label="In the bank" value={money(snap.cashCents)} sub="across accounts" />
            <Stat label="Card owed" value={money(snap.apCents)} />
            <Stat label="Committed" value={money(BigInt(committed))} sub="open purchase orders" />
            <Stat
              label="After commitments"
              value={money((snap.cashCents ?? 0n) - (snap.apCents ?? 0n) - BigInt(committed))}
            />
          </div>

          <div className="rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm text-warn sm:px-5">
            Bank feed balances, not the accounting ledger. While the books are being
            reconciled the two disagree materially &mdash; the ledger has had Main-cleocamp
            at &minus;$27,954 against a real balance of $12,974. These are the ones to trust.
          </div>

          {Array.isArray((snap.raw as any)?.accounts) ? (
            <Card title="Accounts">
              <ul className="divide-y divide-line">
                {((snap.raw as any).accounts as Array<{ name: string; type: string; balance: number }>).map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{a.name}</p>
                      <p className="text-xs text-faint">{a.type}</p>
                    </div>
                    <p className="tnum shrink-0 text-sm">
                      {a.balance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : (
        <Empty>Connected, but nothing pulled yet. The nightly job will fetch it.</Empty>
      )}
    </Page>
  )
}
