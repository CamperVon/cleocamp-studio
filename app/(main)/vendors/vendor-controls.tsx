'use client'
import { useState, useTransition, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addVendor, setVendorActive, updateVendor, type VendorInput } from './actions'

const input = 'w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm'
const small = 'rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40'
export const EMPTY_VENDOR: VendorInput = { name: '', role: 'COMPONENT_SUPPLIER', legalName: '', contactName: '', email: '', ccEmails: '', address: '', orderMethod: '', paymentTerms: '', leadTimeDays: '', notes: '' }

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

function VendorForm({ start, onSave, pending, label }: { start: VendorInput; onSave: (v: VendorInput) => void; pending: boolean; label: string }) {
  const [f, setF] = useState(start)
  const set = (k: keyof VendorInput) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); onSave(f) }}>
      <div className="flex gap-2">
        <input value={f.name} onChange={set('name')} placeholder="Name, as you say it" className={input} />
        <select value={f.role} onChange={set('role')} className={`${input} max-w-[45%]`}>
          <option value="COMPONENT_SUPPLIER">Supplier</option>
          <option value="MANUFACTURER">Manufacturer</option>
          <option value="DYE_HOUSE">Dye house</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <input value={f.legalName} onChange={set('legalName')} placeholder="Legal / company name (optional)" className={input} />
      <input value={f.contactName} onChange={set('contactName')} placeholder="Contact name" className={input} />
      <input value={f.email} onChange={set('email')} placeholder="Email (where POs go)" type="email" className={input} />
      <input value={f.ccEmails} onChange={set('ccEmails')} placeholder="Always cc (emails, comma between)" className={input} />
      <input value={f.address} onChange={set('address')} placeholder="Address" className={input} />
      <div className="flex gap-2">
        <input value={f.orderMethod} onChange={set('orderMethod')} placeholder="How to order" className={input} />
        <input value={f.paymentTerms} onChange={set('paymentTerms')} placeholder="Terms, e.g. Net 30" className={input} />
      </div>
      <input value={f.leadTimeDays} onChange={set('leadTimeDays')} inputMode="numeric" placeholder="Lead time in days (leave blank if not known)" className={input} />
      <textarea value={f.notes} onChange={set('notes')} placeholder="Notes" rows={2} className={input} />
      <button type="submit" disabled={pending || !f.name.trim()} className="self-start rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg disabled:opacity-40">{pending ? 'Saving…' : label}</button>
    </form>
  )
}

export function NewVendor() {
  const { pending, go, note } = useSave()
  const [n, setN] = useState(0)
  return (
    <div className="flex flex-col gap-2">
      <VendorForm key={n} start={EMPTY_VENDOR} pending={pending} label="Add vendor" onSave={(v) => go(() => addVendor(v), () => setN(n + 1))} />
      {note}
    </div>
  )
}

export function VendorEditor({ id, start, active }: { id: string; start: VendorInput; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const [sure, setSure] = useState(false)
  const { pending, go, note } = useSave()
  if (!active) {
    return (
      <div className="flex flex-col gap-1 pt-2">
        <button type="button" disabled={pending} className={`${small} self-start`} onClick={() => go(() => setVendorActive(id, true))}>{pending ? '…' : 'Put back'}</button>
        {note}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 pt-2">
      {editing ? <VendorForm start={start} pending={pending} label="Save" onSave={(v) => go(() => updateVendor(id, v), () => setEditing(false))} /> : null}
      <span className="flex flex-wrap gap-2">
        <button type="button" className={small} onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit details'}</button>
        {sure ? (
          <>
            <button type="button" disabled={pending} className="rounded-lg border border-urgent px-3 py-1.5 text-xs font-medium text-urgent disabled:opacity-40" onClick={() => go(() => setVendorActive(id, false))}>{pending ? '…' : 'Yes, remove'}</button>
            <button type="button" className={small} onClick={() => setSure(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className={small} onClick={() => setSure(true)}>Remove vendor</button>
        )}
      </span>
      {note}
    </div>
  )
}
