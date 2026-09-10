'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function PoExportButton({ poNumber }: { poNumber: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [path, setPath] = useState('')
  const router = useRouter()
  async function prepare() {
    setBusy(true)
    setError('')
    setPath('')
    try {
      const res = await fetch(`/po/${encodeURIComponent(poNumber)}/exports`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not prepare the copy.')
      setPath(data.documentPath)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }
  return <div className="space-y-2">
    <button type="button" onClick={prepare} disabled={busy}
      className="rounded border border-[#14181A]/20 px-3 py-2 font-sans text-[#14181A] hover:bg-black/5 disabled:opacity-50">
      {busy ? 'Preparing copy…' : 'Prepare clean PDF'}
    </button>
    <p className="text-[#5C6663]">For you to send. No draft label; nothing is emailed.</p>
    <div aria-live="polite">
      {path ? <a href={path} className="font-sans underline text-[#14181A]">Download your saved copy</a> : null}
      {error ? <p role="alert" className="text-[#8C3A2B]">{error}</p> : null}
    </div>
  </div>
}
