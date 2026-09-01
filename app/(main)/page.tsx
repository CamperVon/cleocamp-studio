import Link from 'next/link'
import { db } from '@/lib/db'
import { Page, Card, Empty, Chip, Value } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function Today() {
  // One round trip rather than five. Neon is in us-west and Vercel functions
  // run in us-east, so chained queries cost real latency — see CLAUDE.md §5.
  const [items, alerts, links, components, variantCount, countedCount] = await Promise.all([
    db.actionItem.findMany({
      where: { resolved: false },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    }),
    db.alert.findMany({ where: { resolved: false }, orderBy: { createdAt: 'desc' } }),
    db.fileLink.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.component.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { vendor: { select: { name: true } } },
    }),
    db.productVariant.count(),
    db.productVariant.count({ where: { onHandQty: { not: null } } }),
  ])

  const todos = items.filter((i) => i.kind === 'TODO')
  const questions = items.filter((i) => i.kind === 'QUESTION')

  return (
    <Page title="Today" lede="What needs attention, and what Studio Mouse is still waiting to learn.">
      {/* Studio Mouse chat lands here next. */}
      <Card title="Studio Mouse">
        <div className="px-4 py-8 text-center sm:px-5">
          <p className="text-sm text-muted">
            The chat goes here. Until then, everything below is read-only.
          </p>
        </div>
      </Card>

      <Card title={`Things to tend to (${alerts.length + items.length})`}>
        {alerts.length + items.length === 0 ? (
          <Empty>Nothing outstanding.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <Chip tone={a.severity === 'URGENT' ? 'urgent' : 'warn'}>{a.severity}</Chip>
                <p className="text-sm">{a.message}</p>
              </li>
            ))}
            {todos.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <Chip tone="accent">TO DO</Chip>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.detail ? <p className="mt-0.5 text-sm text-muted">{t.detail}</p> : null}
                </div>
              </li>
            ))}
            {questions.map((q) => (
              <li key={q.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <Chip>ASKING</Chip>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{q.title}</p>
                  {q.detail ? <p className="mt-0.5 text-sm text-muted">{q.detail}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Expandable so it isn't in the way, but one tap from anywhere. */}
      <details className="group overflow-hidden rounded-xl border border-line bg-surface">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">Everything in the studio</h2>
          <span className="text-xs text-faint">
            {countedCount}/{variantCount} finished · {components.length} components
          </span>
        </summary>
        <div className="border-t border-line">
          {countedCount === 0 ? (
            <p className="bg-warn-soft px-4 py-3 text-sm text-warn sm:px-5">
              Nothing has been counted yet. Day one is a counting day — Studio Mouse will
              walk through it with you and everything you enter becomes a counted event,
              never an overwrite.
            </p>
          ) : null}
          <ul className="divide-y divide-line">
            {components.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{c.name}</p>
                  <p className="truncate text-xs text-faint">
                    {c.vendor?.name ?? 'no vendor'}
                    {c.vendorSku ? ` · ${c.vendorSku}` : ''}
                  </p>
                </div>
                <p className="shrink-0 text-sm">
                  <Value value={String(c.onHandQty)} unit={c.unitOfMeasure} />
                </p>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <Card title="Quick links">
        <ul className="divide-y divide-line">
          {links.map((l) => (
            <li key={l.id}>
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-sunk sm:px-5"
              >
                <span className="truncate text-sm">{l.title}</span>
                <span className="shrink-0 text-xs text-faint">{l.category}</span>
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-center text-xs text-faint">
        <Link href="/items" className="underline underline-offset-2">
          See everything Studio Mouse is waiting on
        </Link>
      </p>
    </Page>
  )
}
