import { db } from '@/lib/db'
import { Page, Card, Chip, Empty, Money } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

/**
 * What has shipped to wholesale and consignment accounts, and what's been
 * paid. Seeded 4 Sept 2026 from the studio's own spreadsheet, last three
 * months only — see git history for the full account list if older history
 * is ever needed, it stays in the sheet rather than living twice.
 *
 * Deliberately reads nothing from Component, ProductVariant or
 * InventoryEvent — Brandon: "do NOT change inventory in any way." This page
 * (and the tools behind it) never touch a count; Shopify stays the only
 * place on-hand lives.
 */
export default async function Wholesale() {
  const accounts = await db.wholesaleAccount.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    include: { shipments: { include: { lines: true }, orderBy: { sentAt: 'desc' } } },
  })

  const row = (a: (typeof accounts)[number]) => {
    const totalOwed = a.shipments.reduce((n, s) => {
      if (s.paid) return n
      const shipmentTotal = s.lines.reduce((m, l) => {
        // Consignment only owes on what's actually sold; wholesale owes
        // regardless of whether it's sold yet.
        if (a.type === 'CONSIGNMENT' && !l.soldAt) return m
        return m + (l.wholesaleCents ?? 0)
      }, 0)
      return n + shipmentTotal
    }, 0)
    const unconfirmed = a.shipments.filter((s) => s.paid === null).length

    return (
      <li key={a.id} className="px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{a.name}</p>
            <Chip tone={a.type === 'CONSIGNMENT' ? 'accent' : 'neutral'}>
              {a.type === 'CONSIGNMENT' ? `Consignment${a.commissionSplit ? ` · ${a.commissionSplit}` : ''}` : 'Wholesale'}
            </Chip>
          </div>
          <Money cents={totalOwed} />
        </div>
        {a.contactName || a.address ? (
          <p className="mt-1 text-xs text-muted">{[a.contactName, a.address].filter(Boolean).join(' · ')}</p>
        ) : null}
        <ul className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
          {a.shipments.map((s) => {
            const total = s.lines.reduce((n, l) => n + (l.wholesaleCents ?? 0), 0)
            const soldOfLines = s.lines.filter((l) => l.soldAt).length
            return (
              <li key={s.id} className="flex items-start justify-between gap-3 text-xs">
                <div>
                  <span className="text-muted">
                    {s.sentAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}
                  </span>
                  {' · '}
                  {s.lines.length} line{s.lines.length === 1 ? '' : 's'}
                  {a.type === 'CONSIGNMENT' ? ` · ${soldOfLines} sold` : ''}
                  {s.notes ? ` · ${s.notes}` : ''}
                </div>
                <div className="shrink-0 text-right">
                  <span className="tnum">{total ? `$${(total / 100).toFixed(2)}` : '—'}</span>
                  <span className={s.paid === true ? ' text-muted' : s.paid === false ? ' text-urgent' : ' text-faint'}>
                    {' · '}
                    {s.paid === true ? `paid${s.paidAt ? ' ' + s.paidAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''}` : s.paid === false ? 'unpaid' : 'not confirmed'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </li>
    )
  }

  const totalOutstanding = accounts.reduce((n, a) => {
    const owed = a.shipments.reduce((m, s) => {
      if (s.paid) return m
      const t = s.lines.reduce((k, l) => k + ((a.type === 'CONSIGNMENT' && !l.soldAt) ? 0 : (l.wholesaleCents ?? 0)), 0)
      return m + t
    }, 0)
    return n + owed
  }, 0)
  const unconfirmedCount = accounts.reduce((n, a) => n + a.shipments.filter((s) => s.paid === null).length, 0)

  return (
    <Page
      title="Wholesale"
      lede="What has shipped to wholesale and consignment accounts, and what's been paid — not inventory, that stays in Shopify."
    >
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-xs text-faint">Outstanding (confirmed unpaid + consignment sold)</p>
          <p className="mt-1 text-xl font-semibold tnum">${(totalOutstanding / 100).toFixed(2)}</p>
        </div>
        {unconfirmedCount ? (
          <div className="flex-1 rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-xs text-faint">Payment status not confirmed</p>
            <p className="mt-1 text-xl font-semibold tnum">{unconfirmedCount} shipment{unconfirmedCount === 1 ? '' : 's'}</p>
          </div>
        ) : null}
      </div>

      <Card title={`Accounts (${accounts.length})`}>
        {accounts.length === 0 ? (
          <Empty>No wholesale accounts yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">{accounts.map(row)}</ul>
        )}
      </Card>
    </Page>
  )
}
