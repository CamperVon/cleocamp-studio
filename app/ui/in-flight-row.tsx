'use client'
import { useState, useTransition } from 'react'
import { addInFlightUpdate } from '@/app/(main)/in-flight-actions'

/**
 * A run or order in flight, with somewhere to type what has happened to it.
 * Updates go through Studio Mouse, so they move dates rather than pile up as
 * commentary.
 */
export function InFlightRow({
  kind, id, title, subtitle, right, rightNote, history,
}: {
  kind: 'run' | 'po'
  id: string
  title: string
  subtitle: string
  right: string
  rightNote?: string | null
  history: string[]
}) {
  const [text, setText] = useState('')
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer items-start justify-between gap-3 px-4 py-3 hover:bg-sunk sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            {/* Wraps rather than truncating — the journey is the useful part
                and a phone cuts it off at exactly the wrong word. */}
            <p className="text-xs leading-snug text-muted">{subtitle}</p>
          </div>
          <p className="shrink-0 text-right text-xs">
            <span className="text-muted">{right}</span>
            {rightNote ? <span className="block text-warn">{rightNote}</span> : null}
          </p>
        </summary>

        <div className="flex flex-col gap-2.5 border-t border-line bg-sunk/40 px-4 py-3 sm:px-5">
          {history.length ? (
            <ul className="flex flex-col gap-1">
              {history.map((h, i) => (
                <li key={i} className="text-xs text-muted">&middot; {h}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-faint">Nothing recorded against this yet.</p>
          )}

          {saved ? (
            <p className="text-xs text-accent">
              Applied. Reload to see the dates move.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What's happened? e.g. dye house is running a week late"
                disabled={pending}
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm
                           outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && text.trim() && !pending) {
                    start(async () => { await addInFlightUpdate(kind, id, text); setSaved(true) })
                  }
                }}
              />
              <button
                type="button"
                disabled={pending || !text.trim()}
                onClick={() => start(async () => { await addInFlightUpdate(kind, id, text); setSaved(true) })}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white
                           disabled:opacity-40 dark:text-[#0F1211]"
              >
                {pending ? 'Applying…' : 'Add update'}
              </button>
            </div>
          )}
        </div>
      </details>
    </li>
  )
}
