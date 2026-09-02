'use client'
import { useState, useTransition } from 'react'
import { answerItem, dismissItem } from '@/app/(main)/items/actions'
import { Chip } from './primitives'

/**
 * One thing to tend to. Answer it here or wave it away — the point is that it
 * takes one tap, because a list you cannot clear stops being read.
 */
export function ItemRow({
  id, kind, title, detail,
}: { id: string; kind: string; title: string; detail: string | null }) {
  const [answer, setAnswer] = useState('')
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)

  if (done) return null

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2.5 px-4 py-2 hover:bg-sunk sm:px-5">
          <Chip tone={kind === 'TODO' ? 'accent' : 'neutral'}>{kind === 'TODO' ? 'do' : 'ask'}</Chip>
          <p className="min-w-0 flex-1 truncate text-sm">{title}</p>
        </summary>

        <div className="flex flex-col gap-2.5 px-4 pb-3.5 pl-[3.6rem] sm:px-5 sm:pl-[4.1rem]">
          {detail ? <p className="text-sm text-muted">{detail}</p> : null}

          <div className="flex flex-wrap gap-2">
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={kind === 'TODO' ? 'Note what you did…' : 'Answer…'}
              disabled={pending}
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm
                         outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && answer.trim() && !pending) {
                  start(async () => { await answerItem(id, answer); setDone(true) })
                }
              }}
            />
            <button
              type="button"
              disabled={pending || !answer.trim()}
              onClick={() => start(async () => { await answerItem(id, answer); setDone(true) })}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white
                         disabled:opacity-40 dark:text-[#0F1211]"
            >
              {pending ? 'Saving…' : 'Answer'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => { await dismissItem(id); setDone(true) })}
              className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm text-muted
                         hover:bg-sunk disabled:opacity-40"
            >
              Dismiss
            </button>
          </div>
          {pending ? (
            <p className="text-xs text-faint">
              Studio Mouse is applying this, not just filing it.
            </p>
          ) : null}
        </div>
      </details>
    </li>
  )
}
