import { db } from '@/lib/db'
import { Page, Card, Empty } from '@/app/ui/primitives'
import { ItemRow } from '@/app/ui/item-row'
import { packageGap } from '@/lib/gap'
import { GapCard } from '@/app/ui/gap-card'

export const dynamic = 'force-dynamic'

// Outside the component, as on Home: a server page reading the clock is fine,
// but the lint rule for components cannot tell it apart from a re-render.
function dueLabel(d: Date | null): string | null {
  if (!d) return null
  const label = d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })
  return d.getTime() < Date.now() - 864e5 ? `was due ${label}` : `due ${label}`
}

export default async function Items() {
  const items = await db.actionItem.findMany({
    orderBy: [{ resolved: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  })
  // Gaps are their own thing: not something Cleo can answer and not something
  // anyone in the studio can do, so mixing them into "Open" would put items
  // nobody here can action in the list of things they must. They sit below,
  // waiting on a code change.
  const open = items.filter((i) => !i.resolved && i.kind !== 'GAP')
  const asks = open.filter((i) => i.kind === 'QUESTION')
  const todos = open.filter((i) => i.kind !== 'QUESTION')
  const done = items.filter((i) => i.resolved && i.kind !== 'GAP')
  const gaps = await Promise.all(items.filter((i) => !i.resolved && i.kind === 'GAP').map(packageGap))

  return (
    <Page
      title="To tend to"
      lede="Everything Studio Mouse is waiting on — questions it needs answered and todos people have set."
    >
      {/* The same tappable rows as Home, not a printout of them: answer or
          dismiss right here. Until 24 Sept 2026 this page listed the very
          same items as plain text, so Home could clear them and the page
          named for them could not. */}
      <Card title={`Mouse is asking (${asks.length})`}>
        {asks.length === 0 ? (
          <Empty>Nothing to answer. Mouse knows what it needs.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {asks.map((i) => <ItemRow key={i.id} id={i.id} kind={i.kind} title={i.title} detail={i.detail} due={dueLabel(i.dueDate)} />)}
          </ul>
        )}
      </Card>

      <Card title={`On your list (${todos.length})`}>
        {todos.length === 0 ? (
          <Empty>Nothing on the list.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {todos.map((i) => <ItemRow key={i.id} id={i.id} kind={i.kind} title={i.title} detail={i.detail} due={dueLabel(i.dueDate)} />)}
          </ul>
        )}
      </Card>

      {gaps.length ? (
        <Card title={`For Claude — Studio Mouse couldn't (${gaps.length})`}>
          <ul className="divide-y divide-line">
            {gaps.map((g) => <GapCard key={g.id} gap={g} />)}
          </ul>
        </Card>
      ) : null}

      {done.length ? (
        <Card title={`Answered (${done.length})`}>
          <ul className="divide-y divide-line">
            {done.map((i) => (
              <li key={i.id} className="px-4 py-3.5 sm:px-5">
                <p className="text-sm font-medium text-muted">{i.title}</p>
                {i.resolutionNote ? (
                  <p className="mt-0.5 text-sm text-muted">{i.resolutionNote}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Page>
  )
}
