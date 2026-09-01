import { db } from '@/lib/db'
import { Page, Card, Empty, Chip } from '@/app/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function Items() {
  const items = await db.actionItem.findMany({
    orderBy: [{ resolved: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  })
  const open = items.filter((i) => !i.resolved)
  const done = items.filter((i) => i.resolved)

  return (
    <Page
      title="To tend to"
      lede="Everything Studio Mouse is waiting on — questions it needs answered and todos people have set."
    >
      <Card title={`Open (${open.length})`}>
        {open.length === 0 ? (
          <Empty>Nothing outstanding.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                <Chip tone={i.kind === 'TODO' ? 'accent' : 'neutral'}>
                  {i.kind === 'TODO' ? 'TO DO' : 'ASKING'}
                </Chip>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{i.title}</p>
                  {i.detail ? <p className="mt-0.5 text-sm text-muted">{i.detail}</p> : null}
                  {i.dueDate ? (
                    <p className="mt-1 text-xs text-warn">
                      Due {i.dueDate.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
