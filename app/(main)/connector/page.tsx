import { db } from '@/lib/db'
import { Card, Empty, Fold, Page } from '@/app/ui/primitives'
import { disconnect } from './actions'

export const dynamic = 'force-dynamic'

const when = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * The read-only Claude connector (lib/mcp/): which apps are connected, and
 * every look-up they made. The log keeps the tool, the time and whether it
 * worked, never what was asked or answered.
 */
export default async function Connector() {
  const now = new Date()
  const [live, calls, people] = await Promise.all([
    // Connected = holds a refresh token that is unspent, unrevoked and unexpired.
    db.mcpGrant.findMany({
      where: { kind: 'refresh', usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { clientId: true, personId: true, createdAt: true, client: { select: { name: true } } },
    }),
    db.mcpCall.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    db.person.findMany({ select: { id: true, name: true } }),
  ])
  const who = new Map(people.map((p) => [p.id, p.name]))
  const apps = [...new Map(live.map((g) => [g.clientId, g])).values()]
  const failed = calls.filter((c) => !c.ok).length

  return (
    <Page title="Claude Connector" lede="Claude can read Studio Mouse through its connector: products, stock, prices, POs, vendors, open questions, notes and the daily brief. It can't change anything.">
      <Card title={`Connected (${apps.length})`}>
        {apps.length === 0 ? <Empty>Nothing connected. In Claude: Settings → Connectors → Add custom connector, with https://admin.cleocamp.com/api/mcp.</Empty> : (
          <ul className="divide-y divide-line">
            {apps.map((a) => (
              <li key={a.clientId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                <span>
                  <span className="font-medium">{a.client.name ?? 'Claude'}</span>
                  <span className="text-xs text-muted"> · allowed {when(a.createdAt)}{a.personId && who.get(a.personId) ? ` by ${who.get(a.personId)}` : ''}</span>
                </span>
                <form action={disconnect}>
                  <input type="hidden" name="clientId" value={a.clientId} />
                  <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-xs">Disconnect</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <Fold summary={
          <span className="flex items-center justify-between gap-3">
            <span className="font-serif text-[17px] italic text-accent">Look-ups</span>
            <span className="text-xs text-muted">{calls.length ? `last ${calls.length}` : 'none yet'}{failed ? <span className="text-warn"> · {failed} failed</span> : null}</span>
          </span>
        }>
          {calls.length === 0 ? <Empty>No look-ups yet.</Empty> : (
            <ul className="divide-y divide-line">
              {calls.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm sm:px-5">
                  <span className="font-mono text-xs">{c.tool}</span>
                  <span className="text-xs text-muted">
                    {c.ok ? 'ok' : <span className="text-warn">{c.errorKind ?? 'failed'}</span>} · {c.durationMs} ms · {when(c.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Fold>
      </Card>
    </Page>
  )
}
