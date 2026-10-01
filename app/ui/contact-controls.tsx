'use client'
import { useState, useTransition, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addContactByHand, setContactRemovedByHand, updateContactByHand } from './contact-actions'

const input = 'w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm'
const small = 'rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40'
type Form = { circle?: string; name: string; role: string; company: string; email: string; phone: string; instagram: string; address: string; notes: string }
const EMPTY: Form = { name: '', role: '', company: '', email: '', phone: '', instagram: '', address: '', notes: '' }
export type ContactInfo = { id: string; circle: string; atTop?: boolean; name: string; role: string | null; company: string | null; email: string | null; phone: string | null; instagram: string | null; address: string | null; notes: string | null }

function useSave() {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const router = useRouter()
  const go = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) => start(async () => {
    setMsg(null)
    const r = await fn()
    setMsg(r.ok ? (r.message ? { text: r.message, bad: false } : null) : { text: r.error, bad: true })
    if (r.ok) { after?.(); router.refresh() }
  })
  const note = msg ? <p className={`text-xs ${msg.bad ? 'font-medium text-urgent' : 'text-muted'}`}>{msg.text}</p> : null
  return { pending, go, note }
}

function ContactForm({ start, onSave, pending, label, onCancel }: { start: Form; onSave: (f: Form) => void; pending: boolean; label: string; onCancel?: () => void }) {
  const [f, setF] = useState(start)
  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); onSave(f) }}>
      <input value={f.name} onChange={set('name')} placeholder="Name" className={input} />
      {f.circle ? (
        <select value={f.circle} onChange={set('circle')} className={input} aria-label="Which list">
          <option value="FRIEND_OF_BRAND">Friends of the Brand</option>
          <option value="CREW">Cleo Crew: internal</option>
          <option value="WORKS_WITH">Cleo Crew: Friends We Like to Work With</option>
        </select>
      ) : null}
      <div className="flex gap-2">
        <input value={f.role} onChange={set('role')} placeholder="Role or title" className={`${input} flex-1`} />
        <input value={f.company} onChange={set('company')} placeholder="Company" className={`${input} flex-1`} />
      </div>
      <input value={f.email} onChange={set('email')} placeholder="Email" type="email" className={input} />
      <div className="flex gap-2">
        <input value={f.phone} onChange={set('phone')} placeholder="Phone" className={`${input} flex-1`} />
        <input value={f.instagram} onChange={set('instagram')} placeholder="Instagram" className={`${input} flex-1`} />
      </div>
      <textarea value={f.address} onChange={set('address')} placeholder="Ship to (name, street, city, state ZIP)" rows={2} className={input} />
      <textarea value={f.notes} onChange={set('notes')} placeholder="Notes" rows={3} className={input} />
      {onCancel ? <p className="text-[11px] text-faint">Clear a box to remove what was there.</p> : null}
      <span className="flex gap-2">
        <button type="submit" disabled={pending || !f.name.trim()} className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg disabled:opacity-40">
          {pending ? 'Saving…' : label}
        </button>
        {onCancel ? <button type="button" className={small} onClick={onCancel}>Cancel</button> : null}
      </span>
    </form>
  )
}

/** "+ Add": someone new on a list, by hand. */
export function NewContact({ circle }: { circle: string }) {
  const { pending, go, note } = useSave()
  const [n, setN] = useState(0)
  return (
    <div className="flex flex-col gap-2">
      <ContactForm key={n} start={EMPTY} pending={pending} label="Add" onSave={(f) => go(() => addContactByHand(circle, f), () => setN(n + 1))} />
      {note}
    </div>
  )
}

/** One person's details, with Edit and Remove (two taps; hidden, not deleted). */
export function ContactDetails({ f }: { f: ContactInfo }) {
  const [editing, setEditing] = useState(false)
  const [sure, setSure] = useState(false)
  const { pending, go, note } = useSave()
  if (editing) {
    const start: Form = { circle: f.circle, name: f.name, role: f.role ?? '', company: f.company ?? '', email: f.email ?? '', phone: f.phone ?? '', instagram: f.instagram ?? '', address: f.address ?? '', notes: f.notes ?? '' }
    return (
      <div className="flex flex-col gap-2">
        <ContactForm start={start} pending={pending} label="Save" onCancel={() => setEditing(false)} onSave={({ circle, ...v }) => go(() => updateContactByHand(f.id, v, circle), () => setEditing(false))} />
        {note}
      </div>
    )
  }
  const ig = f.instagram?.replace(/^@/, '')
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {f.email ? <a href={`mailto:${f.email}`} className="text-accent underline">{f.email}</a> : null}
        {f.phone ? <a href={`tel:${f.phone.replace(/[^+\d]/g, '')}`} className="text-accent underline">{f.phone}</a> : null}
        {ig ? <a href={`https://instagram.com/${ig}`} target="_blank" rel="noreferrer" className="text-accent underline">@{ig}</a> : null}
      </p>
      {f.address ? <p className="whitespace-pre-line text-xs"><span className="text-faint">Ship to </span>{f.address}</p> : null}
      {f.notes ? <p className="whitespace-pre-line text-xs text-muted">{f.notes}</p> : null}
      <span className="flex flex-wrap items-center gap-2 pt-0.5">
        <button type="button" className={small} onClick={() => setEditing(true)}>Edit</button>
        {sure ? (
          <>
            <button type="button" disabled={pending} className="rounded border border-urgent px-2 py-1 text-[11px] font-medium text-urgent disabled:opacity-40"
              onClick={() => go(() => setContactRemovedByHand(f.id, true), () => setSure(false))}>{pending ? '…' : `Yes, remove ${f.name}`}</button>
            <button type="button" className={small} onClick={() => setSure(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className={small} onClick={() => setSure(true)}>Remove</button>
        )}
      </span>
      {note}
    </div>
  )
}

/** Put someone removed back. */
export function PutBack({ id, name }: { id: string; name: string }) {
  const { pending, go, note } = useSave()
  return (
    <li className="flex items-center justify-between gap-2 text-xs text-muted">
      <span>{name}</span>
      <button type="button" disabled={pending} className={small} onClick={() => go(() => setContactRemovedByHand(id, false))}>{pending ? '…' : 'Put back'}</button>
      {note}
    </li>
  )
}
