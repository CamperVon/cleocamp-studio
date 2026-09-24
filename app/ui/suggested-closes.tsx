'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { closeAllSuggested, closeSuggested, keepOpen, reviewNow } from '@/app/(main)/items/actions'
import { MouseFace } from './mouse-face'

type Item = { id: string; title: string; why: string }

/**
 * "Mouse thinks these are done" — the weekly review's suggestions, one tap
 * each to close or keep. Nothing here is closed until someone taps.
 */
export function SuggestedCloses({ items, showReview = false }: { items: Item[]; showReview?: boolean }) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const router = useRouter()
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh() })

  if (!items.length && !showReview) return null
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        <MouseFace size={24} />
        <h2 className="flex-1 font-serif text-[17px] italic text-accent">
          {items.length ? `Mouse thinks these are done (${items.length})` : 'Tidy the list'}
        </h2>
        {items.length > 1 ? (
          <button type="button" disabled={pending} onClick={() => act(closeAllSuggested)} className="rounded border border-line px-2.5 py-1 text-xs">
            Close all
          </button>
        ) : null}
      </div>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.id} className="flex flex-col gap-1.5 px-4 py-2.5 sm:px-5">
              <p className="text-sm">{i.title}</p>
              <p className="text-xs text-muted">{i.why}</p>
              <div className="flex gap-2">
                <button type="button" disabled={pending} onClick={() => act(() => closeSuggested(i.id))} className="rounded bg-ink px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-40">
                  Close
                </button>
                <button type="button" disabled={pending} onClick={() => act(() => keepOpen(i.id))} className="rounded border border-line px-2.5 py-1 text-xs text-muted disabled:opacity-40">
                  Keep open
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted sm:px-5">
          Mouse reads the whole list every Monday and suggests what looks done.
        </p>
      )}
      {showReview ? (
        <div className="border-t border-line px-4 py-2.5 sm:px-5">
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              setMsg('Reading the list…')
              const r = await reviewNow()
              setMsg(r ? `Read ${r.reviewed}; ${r.suggested} look done.` : 'Sign in again.')
              router.refresh()
            })}
            className="text-xs text-muted underline disabled:opacity-40"
          >
            {pending ? 'Mouse is reading the list…' : 'Ask Mouse to review the list now'}
          </button>
          {msg && !pending ? <span className="ml-2 text-xs text-faint">{msg}</span> : null}
        </div>
      ) : null}
    </section>
  )
}
