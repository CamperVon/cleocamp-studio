import Link from 'next/link'
import { db } from '@/lib/db'
import { poLineLabel } from '@/lib/po'
import { Page, Card, Empty, Chip, Value, Stat } from '@/app/ui/primitives'
import { Chat } from '@/app/ui/chat'
import { ItemRow } from '@/app/ui/item-row'
import { InFlightRow } from '@/app/ui/in-flight-row'
import { Mouse } from '@/app/ui/mouse'
import { laMidnight, laDay } from '@/lib/dates'
import { quoteOfTheDay } from '@/lib/quotes'
import { MonthGrid } from '@/app/ui/month'
import { getDailyBrief } from '@/lib/mouse/brief'
import { fetchToShipCount, isConfigured } from '@/lib/integrations/shopify'

export const dynamic = 'force-dynamic'

const day = laDay

/** "3 hours ago", "yesterday" — for the Shopify sync line. */
function sinceLabel(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export default async function Today() {
  const [items, alerts, links, components, variants, sales24, sales7, pos, runs, notes, events, shopifySync] =
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
      db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laMidnight(1) } } }),
      db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laMidnight(7) } } }),
      db.purchaseOrder.findMany({
        where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } },
        include: { vendor: true, forProduct: true, lines: { include: { component: true, productVariant: { include: { product: true, colorway: true } } } } },
        orderBy: { expectedAt: 'asc' },
      }),
      db.productionRun.findMany({
        where: { status: { notIn: ['RECEIVED', 'CANCELLED'] } },
        include: { product: true, vendor: true },
        orderBy: { expectedReadyAt: 'asc' },
      }),
      db.note.findMany({
        where: { entityType: { in: ['PRODUCTION_RUN', 'PURCHASE_ORDER'] } },
        orderBy: { createdAt: 'desc' },
      }),
      db.calendarEvent.findMany({
        where: { date: { gte: laMidnight(0) } },
        orderBy: { date: 'asc' },
        take: 8,
      }),
      db.shopifySyncStatus.findUnique({ where: { id: 'singleton' } }),
    ])

  const dueSoonAll = items.filter((i) => i.dueDate)
  const dueSoon = items.filter((i) => i.dueDate && i.dueDate <= laMidnight(-7))
  const quote = quoteOfTheDay()

  // The month grid needs a Pacific "today" so the ringed day is Cleo's day.
  const laParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const laNum = (t: string) => Number(laParts.find((p) => p.type === t)!.value)
  const today = { year: laNum('year'), month: laNum('month') - 1, day: laNum('day') }
  const inThisMonth = (d: Date) =>
    d.getUTCFullYear() === today.year && d.getUTCMonth() === today.month
  const marked = [
    ...events.filter((e) => inThisMonth(e.date)).map((e) => ({ day: e.date.getUTCDate(), kind: 'event' as const })),
    ...dueSoonAll.filter((t) => inThisMonth(t.dueDate!)).map((t) => ({ day: t.dueDate!.getUTCDate(), kind: 'due' as const })),
  ]
  // Live from Shopify. Null rather than 0 if it cannot be reached — an
  // unreachable API must not read as an empty packing table.
  const toShip = isConfigured() ? await fetchToShipCount().catch(() => null) : null
  const brief = await getDailyBrief().catch((e) => {
    // Never let the day's note take the whole page down with it, but do not
    // swallow it either — a silent null looks identical to "not written yet".
    console.error("Mouse's Corner failed:", e)
    return null
  })
  const attention = alerts.length + items.length

  return (
    <Page title="Home" lede="What needs attention, and what Studio Mouse is still waiting to learn.">
      <Card title="Studio Mouse">
        <Chat />
      </Card>

      <div className="flex flex-wrap gap-3">
        <Stat label="Sold yesterday" value={sales24._sum.unitsSold ?? 0} sub="units, from Shopify" />
        <Stat label="Sold this week" value={sales7._sum.unitsSold ?? 0} sub="last 7 days" />
        <Stat
          label="To ship"
          value={toShip === null ? <span className="text-faint italic">unknown</span> : toShip}
          sub={toShip === null ? 'Shopify unreachable' : 'unfulfilled orders'}
        />
        <Stat
          label="Finished goods"
          value={Number(variants._sum.onHandQty ?? 0)}
          sub={`across ${variants._count} variants`}
        />
        <Stat label="To tend to" value={attention} sub="questions and todos" />
      </div>
      <p className="-mt-4 text-xs text-faint">
        {shopifySync
          ? `Shopify counts synced ${sinceLabel(shopifySync.lastSyncedAt)} — automatically overnight and each morning, or ask Mouse to refresh anytime.`
          : 'Shopify counts have never synced — ask Mouse to run sync_shopify.'}
      </p>

      {brief ? (
        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
            <Mouse size={26} className="text-ink/70" />
            <h2 className="text-sm font-semibold">Mouse&rsquo;s Corner</h2>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3.5 text-sm leading-relaxed sm:px-5">
            {brief.text.split(/\n\s*\n/).map((para, i) => (
              <p key={i}>{para.trim()}</p>
            ))}
          </div>
        </section>
      ) : null}

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
                <InFlightRow
                  key={r.id}
                  kind="run"
                  id={r.id}
                  title={r.product.name}
                  subtitle={
                    r.statusSummary ??
                    `${r.vendor?.name ?? 'no maker set'} · ${r.status.toLowerCase().replace(/_/g, ' ')}`
                  }
                  right={r.expectedReadyAt ? `ready ${day(r.expectedReadyAt)}` : 'no date'}
                  rightNote={r.expectedReadyAt && !r.dateConfirmed ? 'not confirmed' : null}
                  history={notes.filter((n) => n.entityId === r.id).map((n) => n.content)}
                />
              ))}
              {pos.map((p) => (
                <InFlightRow
                  key={p.id}
                  kind="po"
                  id={p.id}
                  title={`PO ${p.poNumber} · ${p.vendor.name}`}
                  subtitle={
                    p.lines.map((l) => `${l.qtyOrdered} ${l.unit} ${poLineLabel(l)}`).join(', ') +
                    (p.forProduct ? ` · for the ${p.forProduct.name}` : '')
                  }
                  right={p.expectedAt ? day(p.expectedAt) : 'ETA unconfirmed'}
                  history={notes.filter((n) => n.entityId === p.id).map((n) => n.content)}
                />
              ))}
            </ul>
          )}
        </div>
      </details>

      <Card
        title="Coming up"
        action={
          process.env.CALENDAR_FEED_URL ? (
            <a
              href={process.env.CALENDAR_FEED_URL}
              className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-sunk"
            >
              Subscribe in Calendar
            </a>
          ) : null
        }
      >
        <div className="grid gap-0 sm:grid-cols-[1fr_15rem]">
        <div className="min-w-0">
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
        </div>
        <div className="border-t border-line px-4 py-3.5 sm:border-l sm:border-t-0 sm:px-4">
          <MonthGrid marked={marked} today={today} />
        </div>
        </div>
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
              <ItemRow key={i.id} id={i.id} kind={i.kind} title={i.title} detail={i.detail} />
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

      <figure className="border-t border-line pt-5 text-center">
        <blockquote className="font-serif text-base italic text-muted">
          &ldquo;{quote.text}&rdquo;
        </blockquote>
        <figcaption className="mt-1 text-xs tracking-wide text-faint">{quote.who}</figcaption>
      </figure>
    </Page>
  )
}
