'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteFile, linkFile, renameFile, unlinkFile } from './actions'

const input = 'w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm'
const small = 'rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40'
const MAX = 4 * 1024 * 1024

export type Targets = Record<'product' | 'component' | 'vendor', Array<{ id: string; name: string }>>
const LABEL = { product: 'Products', component: 'Components', vendor: 'Vendors' } as const

/** One picker for every record a file can be linked to, grouped. Value is "kind:id". */
function RecordPicker({ targets, value, onChange }: { targets: Targets; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">Link it to…</option>
      {(Object.keys(LABEL) as Array<keyof typeof LABEL>).map((k) => (
        <optgroup key={k} label={LABEL[k]}>
          {targets[k].map((r) => <option key={r.id} value={`${k}:${r.id}`}>{r.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

const split = (v: string) => { const i = v.indexOf(':'); return { kind: v.slice(0, i), recordId: v.slice(i + 1) } }

export function UploadFile({ targets }: { targets: Targets }) {
  const router = useRouter()
  const ref = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const nameOf = (v: string) => { const { kind, recordId } = split(v); return targets[kind as keyof Targets]?.find((r) => r.id === recordId)?.name ?? v }

  const send = async () => {
    if (!file) return
    if (file.size > MAX) { setMsg({ text: `That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 4 MB. Scan or export it smaller and try again.`, bad: true }); return }
    setBusy(true); setMsg(null)
    const form = new FormData()
    form.set('file', file)
    form.set('title', title)
    form.set('notes', notes)
    form.set('links', JSON.stringify(links.map(split)))
    const r = await fetch('/api/files', { method: 'POST', body: form }).then((x) => x.json()).catch(() => ({ error: 'The upload did not go through. Try again.' }))
    setBusy(false)
    if (r.error) { setMsg({ text: r.error, bad: true }); return }
    setMsg({ text: 'Kept.', bad: false })
    setFile(null); setTitle(''); setNotes(''); setLinks([]); if (ref.current) ref.current.value = ''
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[a-z0-9]+$/i, '')) }}
        className="text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-bg file:px-3 file:py-1.5 file:text-sm" />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Calamo colour card" className={input} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} className={input} />
      <RecordPicker targets={targets} value={pick} onChange={(v) => { if (v && !links.includes(v)) setLinks([...links, v]); setPick('') }} />
      {links.length ? (
        <div className="flex flex-wrap gap-1.5">
          {links.map((v) => (
            <button key={v} type="button" onClick={() => setLinks(links.filter((x) => x !== v))} className="rounded-full bg-sunk px-2.5 py-1 text-xs">
              {nameOf(v)} <span aria-hidden className="text-faint">×</span>
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" disabled={!file || busy || !title.trim()} onClick={send} className="self-start rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg disabled:opacity-40">
        {busy ? 'Keeping…' : 'Keep this file'}
      </button>
      {msg ? <p className={`text-xs ${msg.bad ? 'font-medium text-urgent' : 'text-muted'}`}>{msg.text}</p> : null}
    </div>
  )
}

export function FileDetails({ file, links, targets }: {
  file: { id: string; title: string; notes: string | null }
  links: Array<{ id: string; name: string; href: string }>
  targets: Targets
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [title, setTitle] = useState(file.title)
  const [notes, setNotes] = useState(file.notes ?? '')
  const [sure, setSure] = useState(false)
  const go = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    setErr(null)
    const r = await fn()
    if (!r.ok) setErr(r.error); else router.refresh()
  })
  return (
    <div className="flex flex-col gap-2.5 border-t border-line bg-sunk/40 px-4 py-3 sm:px-5">
      <a href={`/files/${file.id}`} target="_blank" rel="noreferrer" className="self-start text-sm font-medium text-accent underline underline-offset-2">Open the file</a>
      <div>
        <p className="mb-1 text-xs text-muted">Linked to</p>
        {links.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-1 rounded-full bg-bg px-2.5 py-1 text-xs">
                <a href={l.href} className="hover:underline">{l.name}</a>
                <button type="button" aria-label={`Unlink ${l.name}`} disabled={pending} onClick={() => go(() => unlinkFile(l.id))} className="text-faint hover:text-ink">×</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-faint">Nothing yet.</p>}
      </div>
      <RecordPicker targets={targets} value="" onChange={(v) => { if (v) { const { kind, recordId } = split(v); go(() => linkFile(file.id, kind, recordId)) } }} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} className={input} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || (title === file.title && notes === (file.notes ?? ''))} onClick={() => go(() => renameFile(file.id, title, notes))} className={small}>Save</button>
        {sure ? (
          <>
            <button type="button" disabled={pending} onClick={() => go(() => deleteFile(file.id))} className={`${small} border-urgent text-urgent`}>Delete for good</button>
            <button type="button" onClick={() => setSure(false)} className={small}>Keep it</button>
          </>
        ) : <button type="button" onClick={() => setSure(true)} className={small}>Delete…</button>}
      </div>
      {err ? <p className="text-xs font-medium text-urgent">{err}</p> : null}
    </div>
  )
}
