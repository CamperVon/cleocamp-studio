import { Page, Card, Empty, Fold } from '@/app/ui/primitives'
import { ItemRow } from '@/app/ui/item-row'
import { db } from '@/lib/db'
import { loadStylists, stillOut } from '@/lib/stylists'
import { AddByHand, NoteBox, RequestButtons, ReturnButton } from './stylist-controls'

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
  // Questions only: a to-do (ship the tees once they're back) belongs on the
  // master ToDo list, not here. Brandon, 29 Sept 2026.
  const [all, waiting, notes, variants] = await Promise.all([
    loadStylists(),
    db.actionItem.findMany({
      where: { resolved: false, entityId: 'stylists', kind: 'QUESTION' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, title: true, detail: true },
    }),
    db.note.findMany({
      where: { supersededAt: null, OR: [{ entityId: 'stylists' }, { entityId: { startsWith: 'stylist:' } }] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, entityId: true, content: true },
    }),
    db.productVariant.findMany({
      where: { product: { NOT: { name: { contains: '(part)' } } } },
      select: { id: true, size: true, product: { select: { name: true } }, colorway: { select: { customerName: true } } },
    }),
  ])
  const pieces = variants
    .map((v) => ({ id: v.id, product: v.product.name, label: [v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || v.product.name }))
    .sort((a, b) => a.product.localeCompare(b.product) || a.label.localeCompare(b.label))
  const notesFor = (id: string) => notes.filter((n) => n.entityId === `stylist:${id}`)
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
                {s.openRequests.length ? <span className="text-xs text-warn">asked for {s.openRequests.length} thing{s.openRequests.length === 1 ? '' : 's'}</span> : null}
              </span>
              {s.out ? (
                <span className={`shrink-0 text-right text-xs ${overdue ? 'text-urgent font-semibold' : 'text-muted'}`}>
                  {s.openPulls.length > 1 ? `${s.openPulls.length} pulls · ` : ''}{s.out} out{s.due ? ` · ${overdue ? 'overdue ' : s.openPulls.length > 1 ? 'next back ' : 'back '}${day(s.due)}` : ' · no date'}
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
            <div className="mt-2"><NoteBox stylistId={s.id} notes={notesFor(s.id)} /></div>

            {s.pulls.length ? (
              <div className="mt-3 border-t border-line pt-2">
                <p className="text-[11px] uppercase tracking-wide text-faint">Pulls ({s.pulls.length})</p>
                {/* Each pull on its own, folded: a stylist can have several out at once. */}
                <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                  {s.pulls.map((p) => {
                    const out = p.lines.reduce((n, l) => n + stillOut(l), 0)
                    const late = out > 0 && !!p.dueBackAt && p.dueBackAt < now
                    return (
                      <li key={p.id} className="text-xs">
                        <Fold
                          summary={
                            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                              <span className="min-w-0">
                                <span className="font-medium text-ink">{p.project || 'Pull'}</span>
                                <span className="text-muted"> · sent {day(p.sentAt)}</span>
                              </span>
                              <span className={`shrink-0 ${late ? 'font-semibold text-urgent' : out ? 'text-muted' : 'text-faint'}`}>
                                {out ? `${out} out · ${p.dueBackAt ? `${late ? 'overdue ' : 'due '}${day(p.dueBackAt)}` : 'no return date'}` : 'all back'}
                              </span>
                            </span>
                          }
                        >
                          <div className="px-4 pb-2 sm:px-5">
                            {p.notes ? <p className="pb-1 text-muted">{p.notes}</p> : null}
                            <ul>
                              {p.lines.map((l) => (
                                <li key={l.id} className="flex items-center justify-between gap-3 py-0.5 text-muted">
                                  <span>{l.qty} × {l.item}{l.returnedQty ? ` · ${l.returnedQty} back` : ''}</span>
                                  {stillOut(l) > 0 ? <ReturnButton pullId={p.id} lineId={l.id} qty={stillOut(l)} label={stillOut(l) > 1 ? `${stillOut(l)} back` : 'Back'} /> : null}
                                </li>
                              ))}
                            </ul>
                            {out > 0 && p.lines.length > 1 ? <div className="flex justify-end pt-1"><ReturnButton pullId={p.id} label="All back" /></div> : null}
                          </div>
                        </Fold>
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
                      <RequestButtons requestId={r.id} status={r.status} />
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
            {waiting.map((i) => <ItemRow key={i.id} id={i.id} kind={i.kind} title={i.title} detail={i.detail} yes={YES} plain />)}
          </ul>
        </Card>
      ) : null}
      <Card title={`Out on pulls${withPulls.length ? ` (${piecesOut} piece${piecesOut === 1 ? '' : 's'})` : ''}`}>
        {withPulls.length ? <ul className="divide-y divide-line">{withPulls.map(row)}</ul> : <Empty>Nothing out with a stylist.</Empty>}
      </Card>
      <Card title={`Stylists (${rest.length})`}>
        {rest.length ? <ul className="divide-y divide-line">{rest.map(row)}</ul> : <Empty>No other stylists yet. Forward Mouse a stylist&apos;s email, or tell it about one.</Empty>}
      </Card>
      <Card>
        <Fold summary={<span className="font-medium">Add by hand</span>}>
          <AddByHand stylists={all.map((s) => ({ id: s.id, name: s.name }))} variants={pieces} />
        </Fold>
      </Card>
      <Card title="Notes">
        <div className="px-4 pb-4 sm:px-5">
          <NoteBox notes={notes.filter((n) => n.entityId === 'stylists')} />
        </div>
      </Card>
    </Page>
  )
}
