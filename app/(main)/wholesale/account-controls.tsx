'use client'
import { useState, useTransition, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addAccount, setAccountActive, updateAccount, type AccountInput } from './account-actions'

const input = 'w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm'
const small = 'rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40'
const EMPTY: AccountInput = { name: '', type: 'WHOLESALE', commissionSplit: '', contactName: '', email: '', address: '', notes: '' }

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

function AccountForm({ start, onSave, pending, label }: { start: AccountInput; onSave: (f: AccountInput) => void; pending: boolean; label: string }) {
  const [f, setF] = useState(start)
  const set = (k: keyof AccountInput) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); onSave(f) }}>
      <input value={f.name} onChange={set('name')} placeholder="Store name" className={input} />
      <div className="flex gap-2">
        <select value={f.type} onChange={set('type')} className={input}>
          <option value="WHOLESALE">Wholesale</option>
          <option value="CONSIGNMENT">Consignment</option>
        </select>
        {f.type === 'CONSIGNMENT' ? <input value={f.commissionSplit} onChange={set('commissionSplit')} placeholder="Split, e.g. 60/40" className={input} /> : null}
      </div>
      <input value={f.contactName} onChange={set('contactName')} placeholder="Contact name" className={input} />
      <input value={f.email} onChange={set('email')} placeholder="Email (where invoices go)" type="email" className={input} />
      <input value={f.address} onChange={set('address')} placeholder="Street, city, state ZIP" className={input} />
      <textarea value={f.notes} onChange={set('notes')} placeholder="Notes" rows={2} className={input} />
      <button type="submit" disabled={pending || !f.name.trim()} className="self-start rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg disabled:opacity-40">
        {pending ? 'Saving…' : label}
      </button>
    </form>
  )
}

/** "+ Add an account": a new store, by hand. */
export function NewAccount() {
  const { pending, go, note } = useSave()
  const [n, setN] = useState(0)
  return (
    <div className="flex flex-col gap-2">
      <AccountForm key={n} start={EMPTY} pending={pending} label="Add account" onSave={(f) => go(() => addAccount(f), () => setN(n + 1))} />
      {note}
    </div>
  )
}

/** Edit an account's details, or remove it (two taps; it is hidden, not deleted). */
export function AccountEditor({ id, start }: { id: string; start: AccountInput }) {
  const [editing, setEditing] = useState(false)
  const [sure, setSure] = useState(false)
  const { pending, go, note } = useSave()
  return (
    <div className="flex flex-col gap-2 pt-2">
      {editing ? (
        <AccountForm start={start} pending={pending} label="Save" onSave={(f) => go(() => updateAccount(id, f), () => setEditing(false))} />
      ) : null}
      <span className="flex flex-wrap gap-2">
        <button type="button" className={small} onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit details'}</button>
        {sure ? (
          <>
            <button type="button" disabled={pending} className="rounded-lg border border-urgent px-3 py-1.5 text-xs font-medium text-urgent disabled:opacity-40" onClick={() => go(() => setAccountActive(id, false))}>{pending ? '…' : 'Yes, remove'}</button>
            <button type="button" className={small} onClick={() => setSure(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className={small} onClick={() => setSure(true)}>Remove account</button>
        )}
      </span>
      {note}
    </div>
  )
}

/** A removed account, with the way back. */
export function RestoreAccount({ id, name }: { id: string; name: string }) {
  const { pending, go, note } = useSave()
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-1.5 text-xs text-muted sm:px-5">
      <span>{name}</span>
      <span className="flex flex-col items-end">
        <button type="button" disabled={pending} className="text-accent underline disabled:opacity-40" onClick={() => go(() => setAccountActive(id, true))}>{pending ? '…' : 'Put back'}</button>
        {note}
      </span>
    </li>
  )
}
