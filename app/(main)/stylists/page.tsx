import { Page, Card, Empty, Fold } from '@/app/ui/primitives'
import { ItemRow } from '@/app/ui/item-row'
import { db } from '@/lib/db'
import { loadStylists, stillOut } from '@/lib/stylists'

/**
 * A stylist email is a proposal (CLAUDE.md §4: email never writes), so Mouse
 * raises it as a question tagged "stylists". On 29 Sept 2026 eight of those
 * sat on ToDo while this page stayed empty, and Brandon read it as the
 * emails not going through. So they are shown here, at the top, with the yes
 * that records them.
 */
const YES = {
  label: 'Yes, add it',
  answer: 'Yes. Record it on the Stylists page now: save the stylist, then the request or pull with whatever details are known. Leave out anything not known.',
}

export const dynamic = 'force-dynamic'

/**
 * Stylists: who has pieces out, and what they asked for. Brandon, 28 Sept
 * 2026: "Stylist list. Any with pulls are at the top. Others in a section
 * below. Both drop down. Details in each." Kept by Mouse from the chat and
 * from the requests Cleo forwards; nothing is typed in here.
 */
const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })

export default async function Stylists() {
  const [all, waiting] = await Promise.all([
    loadStylists(),
    db.actionItem.findMany({
      where: { resolved: false, entityId: 'stylists' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, title: true, detail: true },
    }),
  ])
  const now = new Date()
  const withPulls = all.filter((s) => s.out > 0).sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity))
  const rest = all.filter((s) => s.out === 0)
  const piecesOut = withPulls.reduce((n, s) => n + s.out, 0)

  const row = (s: (typeof all)[number]) => {
    const overdue = !!s.due && s.due < now
    return (
      <li key={s.id}>
        <Fold
          summary={
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{s.name}</span>
                {s.company ? <span className="text-xs text-muted">{s.company}</span> : null}
                {s.openRequests.length ? <span className="text-xs text-warn">{s.openRequests.length} request{s.openRequests.length === 1 ? '' : 's'} open</span> : null}
              </span>
              {s.out ? (
                <span className={`shrink-0 text-right text-xs ${overdue ? 'text-urgent font-semibold' : 'text-muted'}`}>
                  {s.out} out{s.due ? ` · ${overdue ? 'overdue ' : 'back '}${day(s.due)}` : ' · no date'}
                </span>
              ) : null}
            </span>
          }
        >
          <div className="px-4 pb-3.5 text-sm sm:px-5">
            <p className="text-xs text-muted">
              {[s.email, s.phone, s.instagram ? `@${s.instagram.replace(/^@/, '')}` : null].filter(Boolean).join(' · ') || 'No contact on file'}
            </p>
            {s.notes ? <p className="mt-1 text-xs text-muted">{s.notes}</p> : null}

            {s.pulls.length ? (
              <div className="mt-3 border-t border-line pt-2">
                <p className="text-[11px] uppercase tracking-wide text-faint">Pulls</p>
                <ul className="mt-1 flex flex-col gap-2">
                  {s.pulls.map((p) => {
                    const out = p.lines.reduce((n, l) => n + stillOut(l), 0)
                    const late = out > 0 && !!p.dueBackAt && p.dueBackAt < now
                    return (
                      <li key={p.id} className="text-xs">
                        <p>
                          <span className="text-muted">{day(p.sentAt)}</span>
                          {p.project ? ` · ${p.project}` : ''}
                          <span className={late ? ' text-urgent' : ' text-muted'}>
                            {' · '}{out ? `${out} still out${p.dueBackAt ? `, due ${day(p.dueBackAt)}` : ', no return date'}` : 'all back'}
                          </span>
                        </p>
                        <ul className="mt-0.5 pl-3">
                          {p.lines.map((l) => (
                            <li key={l.id} className="text-muted">
                              {l.qty} × {l.item}{l.returnedQty ? ` · ${l.returnedQty} back` : ''}
                            </li>
                          ))}
                        </ul>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}

            {s.requests.length ? (
              <div className="mt-3 border-t border-line pt-2">
                <p className="text-[11px] uppercase tracking-wide text-faint">Asked for</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {s.requests.map((r) => (
                    <li key={r.id} className="flex items-baseline justify-between gap-3 text-xs">
                      <span>{r.what}{r.qty ? ` × ${r.qty}` : ''}<span className="text-muted"> · {day(r.createdAt)}{r.neededBy ? `, needed ${day(r.neededBy)}` : ''}</span></span>
                      <span className={`shrink-0 ${r.status === 'OPEN' ? 'text-warn' : 'text-muted'}`}>
                        {r.status === 'OPEN' ? 'open' : r.status === 'TOLD' ? 'told it’s in' : r.status === 'FULFILLED' ? 'sent' : 'closed'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Fold>
      </li>
    )
  }

  return (
    <Page title="Stylists" lede="Who has pieces out on a pull, and what stylists have asked for. Tell Mouse and it keeps this up to date.">
      {waiting.length ? (
        <Card title={`From email, waiting for your yes (${waiting.length})`}>
          <p className="px-4 pb-2 text-xs text-muted sm:px-5">
            Mouse read these from forwarded emails. Email can&apos;t add anything by itself, so tap Yes to add it, or answer with what&apos;s missing.
          </p>
          <ul className="divide-y divide-line">
            {waiting.map((i) => <ItemRow key={i.id} id={i.id} kind={i.kind} title={i.title} detail={i.detail} yes={YES} />)}
          </ul>
        </Card>
      ) : null}
      <Card title={`Out on pulls${withPulls.length ? ` (${piecesOut} piece${piecesOut === 1 ? '' : 's'})` : ''}`}>
        {withPulls.length ? <ul className="divide-y divide-line">{withPulls.map(row)}</ul> : <Empty>Nothing out with a stylist.</Empty>}
      </Card>
      <Card title={`Stylists (${rest.length})`}>
        {rest.length ? <ul className="divide-y divide-line">{rest.map(row)}</ul> : <Empty>No other stylists yet. Forward Mouse a stylist&apos;s email, or tell it about one.</Empty>}
      </Card>
    </Page>
  )
}
