'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addDriveLink, unpinDriveLink } from './actions'

const input = 'w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm'

/** Search Google Drive itself, in a new tab, signed in as whoever is looking. */
export function DriveSearch() {
  const [q, setQ] = useState('')
  const go = () => { if (q.trim()) window.open(`https://drive.google.com/drive/search?q=${encodeURIComponent(q.trim())}`, '_blank', 'noopener') }
  return (
    <form onSubmit={(e) => { e.preventDefault(); go() }} className="flex gap-2 px-4 py-3 sm:px-5">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Google Drive…" className={input} enterKeyHint="search" />
      <button type="submit" disabled={!q.trim()} className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg disabled:opacity-40">Search</button>
    </form>
  )
}

/** Add a link: a name, the Drive link, and which section it goes under. */
export function AddDriveLink({ sections }: { sections: string[] }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [section, setSection] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const save = () => start(async () => {
    setError(null)
    const r = await addDriveLink(title, url, section)
    if (!r.ok) { setError(r.error); return }
    setTitle(''); setUrl(''); setSection('')
    router.refresh()
  })
  return (
    <div className="flex flex-col gap-2 px-4 pb-4 sm:px-5">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name, e.g. Newsletter: Part one interview" className={input} />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the Google Drive link" className={input} inputMode="url" />
      <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="Section, e.g. Newsletter" list="drive-sections" className={input} />
      <datalist id="drive-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
      {error ? <p className="text-xs text-warn">{error}</p> : null}
      <button type="button" onClick={save} disabled={pending || !title.trim() || !url.trim()} className="self-start rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-40">
        {pending ? 'Adding…' : 'Add to Drive page'}
      </button>
    </div>
  )
}

/** Take one link off the page (it stays in Files). */
export function Unpin({ pinId }: { pinId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await unpinDriveLink(pinId); router.refresh() })}
      className="shrink-0 text-xs text-faint underline underline-offset-2 disabled:opacity-40" aria-label="Remove from the Drive page">
      remove
    </button>
  )
}
