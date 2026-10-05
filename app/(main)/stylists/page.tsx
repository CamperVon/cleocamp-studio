import { Page, Card, Empty, Fold } from '@/app/ui/primitives'
import { ItemRow } from '@/app/ui/item-row'
import { db } from '@/lib/db'
import { loadStylists, pullOut, stillOut } from '@/lib/stylists'
import { AddByHand, NoteBox, PullCloseButtons, RequestButtons, ReturnButton, StylistDetails } from './stylist-controls'
import { PageChat } from '@/app/ui/page-chat'

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
      // Some notes Mouse wrote carry the stylist's bare id (Maya's did).
      where: { supersededAt: null, OR: [{ entityId: 'stylists' }, { entityId: { startsWith: 'stylist:' } }, { entityId: { in: (await db.stylist.findMany({ select: { id: true } })).map((x) => x.id) } }] },
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
  const notesFor = (id: string) => notes.filter((n) => n.entityId === `stylist:${id}` || n.entityId === id)
  const now = new Date()
  const withPulls = all.filter((s) => s.out > 0).sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity))
  const asked = all.flatMap((s) => s.openRequests.map((r) => ({ s, r }))).sort((a, b) => a.r.createdAt.getTime() - b.r.createdAt.getTime())
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
            <StylistDetails s={{ id: s.id, name: s.name, email: s.email, phone: s.phone, company: s.company, instagram: s.instagram, notes: s.notes }} canRemove={s.out === 0} />
            <div className="mt-2"><NoteBox stylistId={s.id} notes={notesFor(s.id)} /></div>

            {s.pulls.length ? (
              <div className="mt-3 border-t border-line pt-2">
                <p className="text-[11px] uppercase tracking-wide text-faint">Pulls ({s.pulls.length})</p>
                {/* Each pull on its own, folded: a stylist can have several out at once. */}
                <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                  {s.pulls.map((p) => {
                    const out = pullOut(p)
                    const kept = p.closedAs === 'KEPT'
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
                                {kept ? 'closed, kept' : out ? `${out} out · ${p.dueBackAt ? `${late ? 'overdue ' : 'due '}${day(p.dueBackAt)}` : 'no return date'}` : 'all back'}
                              </span>
                            </span>
                          }
                        >
                          <div className="px-4 pb-2 sm:px-5">
                            {p.notes ? <p className="pb-1 text-muted">{p.notes}</p> : null}
                            {/* The buttons first, so a long pull does not hide them (Brandon, 30 Sept 2026). */}
                            {out > 0 || kept ? (
                              <div className="flex flex-col gap-1 border-b border-line pb-2">
                                <div className="flex flex-wrap items-start gap-1.5">
                                  {out > 0 ? <ReturnButton pullId={p.id} label="All returned, restock" /> : null}
                                  <PullCloseButtons pullId={p.id} closedAs={p.closedAs} />
                                </div>
                                {out > 0 ? <p className="text-[11px] text-faint">Returned puts pieces back on stock. Close out: they kept it, so it stays off stock. Remove: it never happened.</p> : null}
                              </div>
                            ) : null}
                            <ul className="pt-1">
                              {p.lines.map((l) => (
                                <li key={l.id} className="flex items-center justify-between gap-3 py-0.5 text-muted">
                                  <span>{l.qty} × {l.item}{l.returnedQty ? ` · ${l.returnedQty} back` : ''}</span>
                                  {!kept && stillOut(l) > 0 ? <ReturnButton pullId={p.id} lineId={l.id} qty={stillOut(l)} label={stillOut(l) > 1 ? `${stillOut(l)} returned` : 'Returned'} /> : null}
                                </li>
                              ))}
                            </ul>
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
      <PageChat page="Stylists" placeholder="A note for Mouse…" />
      {/* Requests first (Brandon, 5 Oct 2026: "We should have a REQUESTS section
          at the top"): what came in by email and waits for a yes, then what any
          stylist has asked for that is still open. */}
      <Card title={`Requests${waiting.length + asked.length ? ` (${waiting.length + asked.length})` : ''}`}>
        {waiting.length ? (
          <>
            <p className="px-4 pb-2 text-xs text-muted sm:px-5">
              From email, waiting for your yes. Email can&apos;t add anything by itself, so tap Yes to add it, or answer with what&apos;s missing.
            </p>
            <ul className="divide-y divide-line">
              {waiting.map((i) => <ItemRow key={i.id} id={i.id} kind={i.kind} title={i.title} detail={i.detail} yes={YES} plain />)}
            </ul>
          </>
        ) : null}
        {asked.length ? (
          <ul className={`divide-y divide-line ${waiting.length ? 'border-t border-line' : ''}`}>
            {asked.map(({ s, r }) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0">
                  <span className="font-medium">{s.name}</span>
                  <span> asked for {r.what}{r.qty ? ` × ${r.qty}` : ''}</span>
                  <span className="text-xs text-muted"> · {day(r.createdAt)}{r.neededBy ? `, needed ${day(r.neededBy)}` : ''}</span>
                </span>
                <RequestButtons requestId={r.id} status={r.status} />
              </li>
            ))}
          </ul>
        ) : null}
        {!waiting.length && !asked.length ? <Empty>No requests open. Forward a stylist&apos;s email to mouse@send.cleocamp.com, or tell Mouse above.</Empty> : null}
      </Card>
      <Card title={`Out on pulls${withPulls.length ? ` (${piecesOut} piece${piecesOut === 1 ? '' : 's'})` : ''}`}>
        {withPulls.length ? <ul className="divide-y divide-line">{withPulls.map(row)}</ul> : <Empty>Nothing out with a stylist.</Empty>}
      </Card>
      {/* Folded by default, like every list here (Brandon, 30 Sept 2026). */}
      <Card>
        <Fold summary={<span className="flex items-center justify-between gap-3"><span className="font-serif text-[17px] italic text-accent">Stylists</span><span className="text-xs text-muted">{all.length} stylist{all.length === 1 ? '' : 's'}{withPulls.length ? ` · ${withPulls.length} with pieces out` : ''}</span></span>}>
          {/* One "+ Add" for a stylist, a pull or a request (Brandon, 1 Oct 2026). */}
          <div className="border-t border-line">
            <Fold summary={<span className="text-sm font-medium">+ Add</span>}>
              <AddByHand stylists={all.map((s) => ({ id: s.id, name: s.name }))} variants={pieces} />
            </Fold>
          </div>
          {/* Everyone, A to Z, including those with pieces out (Brandon, 5 Oct 2026:
              anyone a pull is made for belongs on the list). */}
          {all.length ? <ul className="divide-y divide-line border-t border-line">{all.map(row)}</ul> : null}
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
