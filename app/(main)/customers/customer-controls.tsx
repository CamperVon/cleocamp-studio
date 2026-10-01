'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addCustomer, pinCustomer, saveCustomerNotes } from './actions'

const input = 'w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm'
const small = 'rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40'

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

/** "+ Add a customer": by email finds them on Shopify; a name alone that Shopify has asks for the email. */
export function AddCustomer() {
  const [f, setF] = useState({ name: '', email: '', notes: '' })
  const { pending, go, note } = useSave()
  return (
    <form className="flex flex-col gap-2 px-4 pb-3.5 sm:px-5" onSubmit={(e) => { e.preventDefault(); go(() => addCustomer(f), () => setF({ name: '', email: '', notes: '' })) }}>
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" className={input} />
      <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email (finds them on Shopify)" type="email" className={input} />
      <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes, special details" rows={3} className={input} />
      <button type="submit" disabled={pending || (!f.name.trim() && !f.email.trim())} className="self-start rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg disabled:opacity-40">
        {pending ? 'Adding…' : 'Add'}
      </button>
      {note}
    </form>
  )
}

/** A customer's notes, editable; and on or off the hand-added list. */
export function CustomerNotes({ id, notes, pinned }: { id: string; notes: string | null; pinned: boolean }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(notes ?? '')
  const { pending, go, note } = useSave()
  if (editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Notes, special details" className={`${input} text-xs`} />
        <span className="flex gap-2">
          <button type="button" disabled={pending} className="rounded-lg bg-ink px-2.5 py-1 text-xs text-bg disabled:opacity-40" onClick={() => go(() => saveCustomerNotes(id, text), () => setEditing(false))}>{pending ? 'Saving…' : 'Save'}</button>
          <button type="button" className={small} onClick={() => { setText(notes ?? ''); setEditing(false) }}>Cancel</button>
        </span>
        {note}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      {notes ? <p className="whitespace-pre-line text-ink">{notes}</p> : null}
      <span className="flex flex-wrap gap-2">
        <button type="button" className={small} onClick={() => setEditing(true)}>{notes ? 'Edit notes' : 'Add notes'}</button>
        <button type="button" disabled={pending} className={small} onClick={() => go(() => pinCustomer(id, !pinned))}>
          {pending ? '…' : pinned ? 'Unpin from the top' : 'Pin to the top'}
        </button>
      </span>
      {note}
    </div>
  )
}
