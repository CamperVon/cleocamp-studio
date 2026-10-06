'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { search } from '@/app/(main)/search-actions'
import type { SearchHit } from '@/lib/search'
import { jumpTo } from './jump'

/**
 * The search box (Brandon, 6 Oct 2026). Type a name, a PO number, an email;
 * the closest hits list as you type, and Enter goes to the first. Code finds
 * them (lib/search.ts), no model, so it costs nothing to use.
 */
export function SearchButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search" className={className}>
        <IconSearch />
      </button>
      {open ? <SearchSheet onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function SearchSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(0)
  const asked = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Ask as they type, a beat after the last key; only the newest answer counts.
  const type = (value: string) => {
    setQ(value)
    if (timer.current) clearTimeout(timer.current)
    const text = value.trim()
    const n = ++asked.current
    if (text.length < 2) { setHits([]); setBusy(false); return }
    setBusy(true)
    timer.current = setTimeout(async () => {
      const r = await search(text).catch(() => [])
      if (n !== asked.current) return
      setHits(r)
      setSel(0)
      setBusy(false)
    }, 150)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const go = (h: SearchHit | undefined) => {
    if (!h) return
    onClose()
    const [path, hash = ''] = h.href.split('#')
    if (path === pathname) {
      window.history.replaceState(null, '', h.href)
      jumpTo(`#${hash}`)
    } else router.push(h.href)
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/20" />
      <div
        className="absolute inset-x-0 top-0 mx-auto max-w-xl border-b border-line bg-surface p-3 shadow-sm sm:top-16 sm:rounded-xl sm:border"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={(e) => { e.preventDefault(); go(hits[sel]) }} className="flex items-center gap-2">
          <span className="text-faint"><IconSearch /></span>
          <input
            autoFocus
            value={q}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            }}
            placeholder="A name, a PO number, an email…"
            enterKeyHint="go"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none placeholder:text-faint"
          />
          <button type="button" onClick={onClose} className="shrink-0 px-1 text-sm text-faint hover:text-ink">Close</button>
        </form>
        {q.trim().length >= 2 ? (
          hits.length ? (
            <ul className="mt-2 max-h-[60dvh] divide-y divide-line overflow-y-auto border-t border-line">
              {hits.map((h, i) => (
                <li key={h.href}>
                  <button
                    type="button"
                    onClick={() => go(h)}
                    onMouseEnter={() => setSel(i)}
                    className={`flex w-full items-baseline justify-between gap-3 px-1 py-2.5 text-left ${i === sel ? 'bg-sunk' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className={`block truncate text-sm ${i === 0 ? 'font-medium text-accent' : 'text-ink'}`}>{h.label}</span>
                      {h.sub ? <span className="block truncate text-xs text-muted">{h.sub}</span> : null}
                    </span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">{h.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 border-t border-line px-1 pt-2.5 text-sm text-muted">{busy ? 'Looking…' : 'Nothing close to that.'}</p>
          )
        ) : null}
      </div>
    </div>
  )
}

function IconSearch() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </svg>
  )
}
