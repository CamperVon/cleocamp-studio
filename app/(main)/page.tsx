import Link from 'next/link'
import { db } from '@/lib/db'
import { Page, Card, Empty, Chip, Value, Stat } from '@/app/ui/primitives'
import { Chat } from '@/app/ui/chat'

export const dynamic = 'force-dynamic'

/** Date boundaries are Pacific. Computing them in UTC shifts a whole day. */
function laDaysAgo(n: number) {
  const la = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  la.setHours(0, 0, 0, 0)
  la.setDate(la.getDate() - n)
  return la
}
const day = (d: Date) =>
  d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })

export default async function Today() {
  const [items, alerts, links, components, variants, sales24, sales7, pos, runs, events] =
    await Promise.all([
      db.actionItem.findMany({
        where: { resolved: false },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      }),
      db.alert.findMany({ where: { resolved: false }, orderBy: { createdAt: 'desc' } }),
      db.fileLink.findMany({ orderBy: { sortOrder: 'asc' } }),
      db.component.findMany({
        where: { active: true, stockedInStudio: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        include: { vendor: { select: { name: true } } },
      }),
      db.productVariant.aggregate({ _count: true, _sum: { onHandQty: true } }),
      db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laDaysAgo(1) } } }),
      db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laDaysAgo(7) } } }),
      db.purchaseOrder.findMany({
        where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } },
        include: { vendor: true, lines: { include: { component: true } } },
        orderBy: { expectedAt: 'asc' },
      }),
      db.productionRun.findMany({
        where: { status: { notIn: ['RECEIVED', 'CANCELLED'] } },
        include: { product: true, vendor: true },
        orderBy: { expectedReadyAt: 'asc' },
      }),
      db.calendarEvent.findMany({
        where: { date: { gte: laDaysAgo(0) } },
        orderBy: { date: 'asc' },
        take: 8,
      }),
    ])

  const dueSoon = items.filter((i) => i.dueDate && i.dueDate <= laDaysAgo(-7))
  const attention = alerts.length + items.length

  return (
    <Page title="Today" lede="What needs attention, and what Studio Mouse is still waiting to learn.">
      <Card title="Studio Mouse">
        <Chat />
      </Card>

      <div className="flex flex-wrap gap-3">
        <Stat label="Sold yesterday" value={sales24._sum.unitsSold ?? 0} sub="units, from Shopify" />
        <Stat label="Sold this week" value={sales7._sum.unitsSold ?? 0} sub="last 7 days" />
        <Stat
          label="Finished goods"
          value={Number(variants._sum.onHandQty ?? 0)}
          sub={`across ${variants._count} variants`}
        />
        <Stat label="To tend to" value={attention} sub="questions and todos" />
      </div>

      {/* What is out of the building and when it comes back. */}
      <details className="group overflow-hidden rounded-xl border border-line bg-surface" open>
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">In production &amp; on order</h2>
          <span className="text-xs text-faint">{runs.length + pos.length} in flight</span>
        </summary>
        <div className="border-t border-line">
          {runs.length + pos.length === 0 ? (
            <Empty>Nothing in flight.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {runs.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.product.name}</p>
                    <p className="text-xs text-muted">
                      {r.vendor?.name ?? 'no maker set'} · {r.status.toLowerCase().replace(/_/g, ' ')}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-xs">
                    {r.expectedReadyAt ? (
                      <>
                        <span className="text-muted">{day(r.expectedReadyAt)}</span>
                        {!r.dateConfirmed ? <span className="block text-warn">not confirmed</span> : null}
                      </>
                    ) : (
                      <span className="text-faint italic">no date</span>
                    )}
                  </p>
                </li>
              ))}
              {pos.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      PO {p.poNumber} · {p.vendor.name}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {p.lines.map((l) => `${l.qtyOrdered} ${l.unit} ${l.component.name}`).join(', ')}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-xs">
                    {p.expectedAt ? (
                      <span className="text-muted">{day(p.expectedAt)}</span>
                    ) : (
                      <span className="text-faint italic">ETA unconfirmed</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <Card title="Coming up">
        {events.length + dueSoon.length === 0 ? (
          <Empty>Nothing on the calendar.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 px-4 py-2.5 sm:px-5">
                <span className="w-24 shrink-0 text-xs text-faint">{day(e.date)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm">{e.title}</p>
                  {e.notes ? <p className="truncate text-xs text-muted">{e.notes}</p> : null}
                </div>
              </li>
            ))}
            {dueSoon.map((t) => (
              <li key={t.id} className="flex items-baseline gap-3 px-4 py-2.5 sm:px-5">
                <span className="w-24 shrink-0 text-xs text-warn">{day(t.dueDate!)}</span>
                <p className="min-w-0 truncate text-sm">{t.title}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Titles only — the detail is a tap away rather than a wall of text. */}
      <Card title={`Things to tend to (${attention})`}>
        {attention === 0 ? (
          <Empty>Nothing outstanding.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 px-4 py-2 sm:px-5">
                <Chip tone={a.severity === 'URGENT' ? 'urgent' : 'warn'}>!</Chip>
                <p className="min-w-0 truncate text-sm">{a.message}</p>
              </li>
            ))}
            {items.map((i) => (
              <li key={i.id}>
                <details className="group">
                  <summary className="flex cursor-pointer items-center gap-2.5 px-4 py-2 hover:bg-sunk sm:px-5">
                    <Chip tone={i.kind === 'TODO' ? 'accent' : 'neutral'}>
                      {i.kind === 'TODO' ? 'do' : 'ask'}
                    </Chip>
                    <p className="min-w-0 flex-1 truncate text-sm">{i.title}</p>
                  </summary>
                  {i.detail ? (
                    <p className="px-4 pb-3 pl-[3.6rem] text-sm text-muted sm:px-5 sm:pl-[4.1rem]">
                      {i.detail}
                    </p>
                  ) : null}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <details className="group overflow-hidden rounded-xl border border-line bg-surface">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">Studio supplies</h2>
          <span className="text-xs text-faint">{components.length} counted here</span>
        </summary>
        <ul className="divide-y divide-line border-t border-line">
          {components.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-sm">{c.name}</p>
                <p className="truncate text-xs text-faint">{c.vendor?.name ?? 'no vendor'}</p>
              </div>
              <p className="shrink-0 text-sm">
                <Value value={String(c.onHandQty)} unit={c.unitOfMeasure} />
              </p>
            </li>
          ))}
        </ul>
      </details>

      <Card title="Quick links">
        <ul className="divide-y divide-line">
          {links.map((l) => (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noreferrer"
                className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-sunk sm:px-5">
                <span className="truncate text-sm">{l.title}</span>
                <span className="shrink-0 text-xs text-faint">{l.category}</span>
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-center text-xs text-faint">
        <Link href="/items" className="underline underline-offset-2">Everything Studio Mouse is waiting on</Link>
      </p>
    </Page>
  )
}
