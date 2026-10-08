'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setSkuDisplayMode } from './actions'

/** The SKU display setting: old and new side by side while switching over, or new only. */
export function SkuModeToggle({ mode }: { mode: 'transition' | 'new' }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const pick = (m: 'transition' | 'new') => start(async () => {
    setErr(null)
    const r = await setSkuDisplayMode(m)
    if (!r.ok) setErr(r.error); else router.refresh()
  })
  const btn = (m: 'transition' | 'new', label: string) => (
    <button type="button" disabled={pending || mode === m} onClick={() => pick(m)}
      className={`rounded-full px-3 py-1 text-xs ${mode === m ? 'bg-accent text-bg' : 'border border-line text-muted'}`}>
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>SKUs:</span>
      {btn('transition', 'New (was old)')}
      {btn('new', 'New only')}
      {err ? <span className="text-urgent">{err}</span> : null}
    </div>
  )
}
