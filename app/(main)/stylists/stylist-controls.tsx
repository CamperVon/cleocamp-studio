'use client'
import { useState, useTransition, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addPull, addRequest, addStylist, addStylistNote, changeStylistStock, closePull, editStylistNote, pingAbout, removeStylist, removeStylistNote, returnPieces, sendRequest, setRequestStatus, updateStylist, takeShortFromSales } from './actions'

type Res = { ok: true; message?: string } | { ok: false; error: string }
const input = 'min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm'
const button = 'shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg disabled:opacity-40'
const small = 'rounded border border-line px-2 py-1 text-[11px] text-muted hover:bg-sunk disabled:opacity-40'

function useAction() {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const router = useRouter()
  const go = (fn: () => Promise<Res>, after?: () => void) => start(async () => {
    setMsg(null)
    const r = await fn()
    setMsg(r.ok ? (r.message ? { text: r.message, bad: false } : null) : { text: r.error, bad: true })
    if (r.ok) { after?.(); router.refresh() }
  })
  const note = msg ? <p className={`text-xs ${msg.bad ? 'font-medium text-urgent' : 'text-muted'}`}>{msg.text}</p> : null
  return { pending, go, note }
}

/** "Returned" for one line of a pull, or for the whole pull. Puts the pieces back on stock. */
export function ReturnButton({ pullId, lineId, qty, label }: { pullId: string; lineId?: string; qty?: number; label: string }) {
  const { pending, go, note } = useAction()
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button type="button" disabled={pending} className={small} onClick={() => go(() => returnPieces({ pullId, lineId, qty }))}>
        {pending ? '…' : label}
      </button>
      {note}
    </span>
  )
}

/**
 * A request: Sent makes the pull from its pieces (sendRequest), Close if it no
 * longer matters, Use sales stock when the stylist inventory is short. Reopen
 * undoes Close; a Sent pull is undone on the pull itself.
 */
export function RequestButtons({ requestId, status, short = false }: { requestId: string; status: string; short?: boolean }) {
  const { pending, go, note } = useAction()
  if (status === 'FULFILLED' || status === 'CLOSED') {
    return (
      <span className="inline-flex shrink-0 items-center gap-2 text-[11px] text-muted">
        {status === 'FULFILLED' ? 'sent' : 'closed'}
        <button type="button" disabled={pending} className="underline" onClick={() => go(() => setRequestStatus(requestId, 'OPEN'))}>reopen</button>
        {note}
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 flex-col items-end gap-0.5">
      <span className="flex gap-1.5">
        {short ? <button type="button" disabled={pending} className={small} onClick={() => go(() => takeShortFromSales(requestId))}>Use sales stock</button> : null}
        <button type="button" disabled={pending} className={small} onClick={() => go(() => sendRequest(requestId))}>Sent</button>
        <button type="button" disabled={pending} className={small} onClick={() => go(() => setRequestStatus(requestId, 'CLOSED'))}>Close</button>
      </span>
      {note}
    </span>
  )
}

/**
 * Ping Jane or Ping Cleo about this request or pull: an email with what it is,
 * a note if you add one, and a link back to it (Brandon, 7 Oct 2026).
 */
export function PingButtons({ kind, id }: { kind: 'request' | 'pull'; id: string }) {
  const [to, setTo] = useState<'jane' | 'cleo' | null>(null)
  const [text, setText] = useState('')
  const { pending, go, note } = useAction()
  if (!to) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <span className="flex gap-1.5">
          <button type="button" className={small} onClick={() => setTo('jane')}>Ping Jane</button>
          <button type="button" className={small} onClick={() => setTo('cleo')}>Ping Cleo</button>
        </span>
        {note}
      </span>
    )
  }
  return (
    <form className="flex w-full flex-col gap-1.5 sm:w-auto" onSubmit={(e) => { e.preventDefault(); go(() => pingAbout(to, kind, id, text), () => { setText(''); setTo(null) }) }}>
      <input value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={`Note for ${to === 'jane' ? 'Jane' : 'Cleo'} (optional)`} className={`${input} py-1.5 text-xs`} />
      <span className="flex justify-end gap-1.5">
        <button type="submit" disabled={pending} className="rounded bg-ink px-2.5 py-1 text-[11px] font-medium text-bg disabled:opacity-40">{pending ? 'Sending…' : `Send to ${to === 'jane' ? 'Jane' : 'Cleo'}`}</button>
        <button type="button" disabled={pending} className={small} onClick={() => setTo(null)}>Cancel</button>
      </span>
      {note}
    </form>
  )
}

/** One team note: Edit changes the words (the old one is retired), Remove retires it. */
function NoteLine({ id, content }: { id: string; content: string }) {
  const shown = content.replace(/^Stylists?(?: [^:]+)?: /, '')
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(shown.replace(/ \([A-Z][a-z]+, [A-Z][a-z]{2} \d{1,2}\)$/, ''))
  const { pending, go, note } = useAction()
  if (!editing) {
    return (
      <li className="flex flex-col gap-0.5">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">{shown}</span>
          <span className="flex shrink-0 gap-2 text-[11px]">
            <button type="button" className="underline" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" disabled={pending} className="underline disabled:opacity-40" onClick={() => go(() => removeStylistNote(id))}>{pending ? '…' : 'Remove'}</button>
          </span>
        </span>
        {note}
      </li>
    )
  }
  return (
    <li className="flex flex-col gap-1.5">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={`${input} text-xs`} />
      <span className="flex gap-2">
        <button type="button" disabled={pending} className="rounded-lg bg-ink px-2.5 py-1 text-xs text-bg disabled:opacity-40" onClick={() => go(() => editStylistNote(id, text), () => setEditing(false))}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={pending} className="text-xs underline" onClick={() => setEditing(false)}>Cancel</button>
      </span>
      {note}
    </li>
  )
}

/** Notes from anyone on the team, on one stylist, or on the page as a whole. Each can be edited or removed. */
export function NoteBox({ stylistId, notes }: { stylistId?: string; notes: Array<{ id: string; content: string }> }) {
  const [text, setText] = useState('')
  const { pending, go, note } = useAction()
  return (
    <div className="flex flex-col gap-1.5">
      {notes.length ? (
        <ul className="flex flex-col gap-1.5 text-xs text-muted">
          {notes.map((n) => <NoteLine key={n.id} id={n.id} content={n.content} />)}
        </ul>
      ) : null}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); go(() => addStylistNote({ stylistId, text }), () => setText('')) }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave a note…" className={`${input} flex-1 py-1.5 text-xs`} />
        <button type="submit" disabled={pending || !text.trim()} className="shrink-0 rounded-lg border border-line px-2.5 text-xs disabled:opacity-40">
          {pending ? 'Saving…' : 'Add'}
        </button>
      </form>
      {note}
    </div>
  )
}

type StylistInfo = { id: string; name: string; email: string | null; phone: string | null; company: string | null; instagram: string | null; notes: string | null }

/**
 * A stylist's contact details and notes, with Edit (blank clears a field) and
 * Remove (two taps; refused while pieces are out).
 */
export function StylistDetails({ s, canRemove }: { s: StylistInfo; canRemove: boolean }) {
  const blank = { name: s.name, email: s.email ?? '', phone: s.phone ?? '', company: s.company ?? '', instagram: s.instagram ?? '', notes: s.notes ?? '' }
  const [editing, setEditing] = useState(false)
  const [sure, setSure] = useState(false)
  const [f, setF] = useState(blank)
  const { pending, go, note } = useAction()
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  if (!editing) {
    const ig = s.instagram?.replace(/^@/, '')
    return (
      <div className="flex flex-col gap-1 text-xs text-muted">
        <p className="flex flex-wrap gap-x-3 gap-y-0.5">
          {s.email ? <a href={`mailto:${s.email}`} className="text-accent underline">{s.email}</a> : null}
          {s.phone ? <a href={`tel:${s.phone.replace(/[^+\d]/g, '')}`} className="text-accent underline">{s.phone}</a> : null}
          {ig ? <a href={`https://instagram.com/${ig}`} target="_blank" rel="noreferrer" className="text-accent underline">@{ig}</a> : null}
          {!s.email && !s.phone && !ig ? <span>No contact on file</span> : null}
        </p>
        {s.notes ? <p className="whitespace-pre-line">{s.notes}</p> : null}
        <span className="flex flex-wrap items-center gap-2 pt-0.5">
          <button type="button" className={small} onClick={() => { setF(blank); setEditing(true) }}>Edit details</button>
          {sure ? (
            <>
              <button type="button" disabled={pending} className="rounded border border-urgent px-2 py-1 text-[11px] font-medium text-urgent disabled:opacity-40"
                onClick={() => go(() => removeStylist(s.id), () => setSure(false))}>{pending ? '…' : `Yes, remove ${s.name}`}</button>
              <button type="button" className={small} onClick={() => setSure(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" disabled={!canRemove} title={canRemove ? '' : 'Pieces are still out'} className={small} onClick={() => setSure(true)}>Remove stylist</button>
          )}
        </span>
        {note}
      </div>
    )
  }
  return (
    <form className="flex flex-col gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); go(() => updateStylist({ id: s.id, ...f }), () => setEditing(false)) }}>
      <input value={f.name} onChange={set('name')} placeholder="Name" className={input} />
      <input value={f.company} onChange={set('company')} placeholder="Agency, or who they style for" className={input} />
      <input value={f.email} onChange={set('email')} placeholder="Email" type="email" className={input} />
      <div className="flex gap-2">
        <input value={f.phone} onChange={set('phone')} placeholder="Phone" className={`${input} flex-1`} />
        <input value={f.instagram} onChange={set('instagram')} placeholder="Instagram" className={`${input} flex-1`} />
      </div>
      <textarea value={f.notes} onChange={set('notes')} rows={4} placeholder="Notes about this stylist" className={input} />
      <p className="text-[11px] text-faint">Clear a box to remove what was there.</p>
      <span className="flex gap-2">
        <button type="submit" disabled={pending || !f.name.trim()} className={`${button} text-xs`}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" className={small} onClick={() => setEditing(false)}>Cancel</button>
      </span>
      {note}
    </form>
  )
}

type Variant = { id: string; label: string; product: string }

/**
 * Add by hand, without Mouse: a stylist, a pull (takes the pieces off stock),
 * or a request for something we could not send.
 */
export function AddByHand({ stylists, variants }: { stylists: Array<{ id: string; name: string }>; variants: Variant[] }) {
  const [tab, setTab] = useState<'pull' | 'request' | 'stylist'>(stylists.length ? 'pull' : 'stylist')
  const tabs = [['pull', 'Pull (pieces out)'], ['request', 'Request'], ['stylist', 'New stylist']] as const
  return (
    <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1 text-xs ${tab === k ? 'bg-ink text-bg' : 'border border-line text-muted'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'stylist' ? <NewStylist onDone={() => setTab('pull')} /> : null}
      {tab !== 'stylist' && !stylists.length ? <p className="text-xs text-muted">Add the stylist first.</p> : null}
      {tab === 'pull' && stylists.length ? <NewPull stylists={stylists} variants={variants} /> : null}
      {tab === 'request' && stylists.length ? <NewRequest stylists={stylists} /> : null}
    </div>
  )
}

function StylistPicker({ stylists, value, onChange }: { stylists: Array<{ id: string; name: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">Stylist…</option>
      {stylists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  )
}

export function NewStylist({ onDone }: { onDone?: () => void }) {
  const [f, setF] = useState({ name: '', email: '', company: '', phone: '', instagram: '' })
  const { pending, go, note } = useAction()
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); go(() => addStylist(f), () => { setF({ name: '', email: '', company: '', phone: '', instagram: '' }); onDone?.() }) }}>
      <input value={f.name} onChange={set('name')} placeholder="Name" className={input} />
      <input value={f.email} onChange={set('email')} placeholder="Email" type="email" className={input} />
      <input value={f.company} onChange={set('company')} placeholder="Agency, or who they style for" className={input} />
      <div className="flex gap-2">
        <input value={f.phone} onChange={set('phone')} placeholder="Phone" className={`${input} flex-1`} />
        <input value={f.instagram} onChange={set('instagram')} placeholder="Instagram" className={`${input} flex-1`} />
      </div>
      <button type="submit" disabled={pending || !f.name.trim()} className={`${button} self-start`}>{pending ? 'Saving…' : 'Add stylist'}</button>
      {note}
    </form>
  )
}

function NewRequest({ stylists }: { stylists: Array<{ id: string; name: string }> }) {
  const [stylistId, setStylist] = useState('')
  const [what, setWhat] = useState('')
  const [neededBy, setNeeded] = useState('')
  const { pending, go, note } = useAction()
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); go(() => addRequest({ stylistId, what, neededBy }), () => { setWhat(''); setNeeded('') }) }}>
      <StylistPicker stylists={stylists} value={stylistId} onChange={setStylist} />
      <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What they asked for" className={input} />
      <label className="flex items-center gap-2 text-xs text-muted">Needed by <input type="date" value={neededBy} onChange={(e) => setNeeded(e.target.value)} className={input} /></label>
      <button type="submit" disabled={pending || !stylistId || !what.trim()} className={`${button} self-start`}>{pending ? 'Saving…' : 'Add request'}</button>
      {note}
    </form>
  )
}

function NewPull({ stylists, variants }: { stylists: Array<{ id: string; name: string }>; variants: Variant[] }) {
  const [stylistId, setStylist] = useState('')
  const [project, setProject] = useState('')
  const [dueBackAt, setDue] = useState('')
  const [lines, setLines] = useState<Array<{ productVariantId: string; qty: number }>>([{ productVariantId: '', qty: 1 }])
  const [salesOk, setSalesOk] = useState(false)
  const { pending, go, note } = useAction()
  const products = [...new Set(variants.map((v) => v.product))]
  const setLine = (i: number, patch: Partial<{ productVariantId: string; qty: number }>) =>
    setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const ready = !!stylistId && lines.some((l) => l.productVariantId && l.qty > 0)
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => {
      e.preventDefault()
      go(() => addPull({ stylistId, project, dueBackAt, items: lines, takeShortFromSales: salesOk }), () => { setProject(''); setDue(''); setLines([{ productVariantId: '', qty: 1 }]); setSalesOk(false) })
    }}>
      <StylistPicker stylists={stylists} value={stylistId} onChange={setStylist} />
      <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Shoot, talent or publication" className={input} />
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <select value={l.productVariantId} onChange={(e) => setLine(i, { productVariantId: e.target.value })} className={`${input} flex-1`}>
            <option value="">Piece…</option>
            {products.map((p) => (
              <optgroup key={p} label={p}>
                {variants.filter((v) => v.product === p).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </optgroup>
            ))}
          </select>
          <input type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className={`${input} w-16`} aria-label="How many" />
        </div>
      ))}
      <button type="button" className="self-start text-xs text-accent underline" onClick={() => setLines([...lines, { productVariantId: '', qty: 1 }])}>+ another piece</button>
      <label className="flex items-center gap-2 text-xs text-muted">Due back <input type="date" value={dueBackAt} onChange={(e) => setDue(e.target.value)} className={input} /></label>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" checked={salesOk} onChange={(e) => setSalesOk(e.target.checked)} className="mt-0.5" />
        <span>If the stylist inventory is short, take the rest from sales stock</span>
      </label>
      <p className="text-[11px] text-faint">Saving takes these pieces from the stylist inventory first. Anything taken from sales stock comes off Shopify too. Tap Back when they return.</p>
      <button type="submit" disabled={pending || !ready} className={`${button} self-start`}>{pending ? 'Saving…' : 'Log pull'}</button>
      {note}
    </form>
  )
}

/**
 * Close a pull: "Kept" when the stylist kept what is out, "Remove" when it was
 * logged by mistake (two taps: it puts pieces back on stock), "Reopen" for a
 * kept one.
 */
export function PullCloseButtons({ pullId, closedAs }: { pullId: string; closedAs: string | null }) {
  const { pending, go, note } = useAction()
  const [sure, setSure] = useState(false)
  if (closedAs === 'KEPT') {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <button type="button" disabled={pending} className={small} onClick={() => go(() => closePull(pullId, 'OPEN'))}>{pending ? '…' : 'Reopen'}</button>
        {note}
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="flex flex-wrap justify-end gap-1.5">
        <button type="button" disabled={pending} className={small} onClick={() => go(() => closePull(pullId, 'KEPT'))}>Close out, they kept it</button>
        {sure ? (
          <>
            <button type="button" disabled={pending} className="rounded border border-urgent px-2 py-1 text-[11px] font-medium text-urgent disabled:opacity-40"
              onClick={() => go(() => closePull(pullId, 'REMOVED'), () => setSure(false))}>{pending ? '…' : 'Yes, remove and restock'}</button>
            <button type="button" disabled={pending} className={small} onClick={() => setSure(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" disabled={pending} className={small} onClick={() => setSure(true)}>Remove, logged by mistake</button>
        )}
      </span>
      {note}
    </span>
  )
}

/** One piece in the stylist inventory: its number, editable, with Remove for none left. */
export function StylistStockRow({ id, label, n }: { id: string; label: string; n: number }) {
  const [qty, setQty] = useState(String(n))
  const { pending, go, note } = useAction()
  const changed = qty.trim() !== '' && Number(qty) !== n
  return (
    <li className="flex flex-col gap-1 px-4 py-2 text-sm sm:px-5">
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className={`${input} w-16 py-1`} aria-label={`How many ${label}`} />
          {changed ? <button type="button" disabled={pending} className={small} onClick={() => go(() => changeStylistStock({ productVariantId: id, qty: Number(qty), action: 'count' }))}>{pending ? '…' : 'Save'}</button> : null}
          <button type="button" disabled={pending} className={small} onClick={() => go(() => changeStylistStock({ productVariantId: id, qty: 0, action: 'count' }), () => setQty('0'))}>Remove</button>
        </span>
      </span>
      {note}
    </li>
  )
}

/** Pieces into the stylist inventory by hand: which piece and how many. */
export function AddStylistStock({ variants }: { variants: Variant[] }) {
  const [vid, setVid] = useState('')
  const [qty, setQty] = useState(1)
  const { pending, go, note } = useAction()
  const products = [...new Set(variants.map((v) => v.product))]
  return (
    <form className="flex flex-col gap-2 px-4 py-3 sm:px-5" onSubmit={(e) => { e.preventDefault(); go(() => changeStylistStock({ productVariantId: vid, qty, action: 'add' }), () => { setVid(''); setQty(1) }) }}>
      <div className="flex gap-2">
        <select value={vid} onChange={(e) => setVid(e.target.value)} className={`${input} flex-1`}>
          <option value="">Piece…</option>
          {products.map((p) => (
            <optgroup key={p} label={p}>
              {variants.filter((v) => v.product === p).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </optgroup>
          ))}
        </select>
        <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className={`${input} w-16`} aria-label="How many" />
      </div>
      <p className="text-[11px] text-faint">Adds to the stylist inventory only. Nothing comes off sales stock or Shopify.</p>
      <button type="submit" disabled={pending || !vid || !(qty > 0)} className={`${button} self-start`}>{pending ? 'Adding…' : 'Add'}</button>
      {note}
    </form>
  )
}
