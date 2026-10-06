'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { answerItem, dismissItem } from '@/app/(main)/items/actions'
import { Chip } from './primitives'

/**
 * One thing to tend to. Answer it here or wave it away — the point is that it
 * takes one tap, because a list you cannot clear stops being read.
 */
export function ItemRow({
  id, kind, title, detail, due, yes, plain, hot,
}: {
  id: string; kind: string; title: string; detail: string | null; due?: string | null
  /** Urgent, due or overdue: the title and date in pink (lib/pressing.ts). */
  hot?: boolean
  /** No ask/do chip: on a page where every row is the same kind (the Stylists page). */
  plain?: boolean
  /** A one-tap answer, e.g. "Yes, add it" on the Stylists page: the label, and the answer it sends. */
  yes?: { label: string; answer: string }
}) {
  const [answer, setAnswer] = useState('')
  const [pending, start] = useTransition()
  // What Mouse says it changed, shown where the row was — the same as the
  // answer box on a product line. A row that simply vanished left nobody
  // knowing whether the answer had been applied or just filed.
  const [done, setDone] = useState<string | null>(null)
  const router = useRouter()

  // The page around this row (its counts, the other list it may also sit in)
  // is server-rendered; refresh it so it catches up without a reload.
  // Brandon, 24 Sept 2026: To tend to "doesn't seem to update in real time".
  const finish = (line: string) => { setDone(line); router.refresh() }
  const submit = (text = answer) => start(async () => finish((await answerItem(id, text)) ?? 'Done.'))

  if (done) {
    return (
      <li className="flex items-baseline gap-2.5 px-4 py-2 text-sm sm:px-5">
        <span className="text-accent">✓</span>
        <span className="min-w-0 text-muted"><span className="text-ink">{title}</span> — {done}</span>
      </li>
    )
  }

  return (
    <li data-rec={id}>
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2.5 px-4 py-2 hover:bg-sunk sm:px-5">
          {plain ? null : <Chip tone={kind === 'TODO' ? 'accent' : 'neutral'}>{kind === 'TODO' ? 'do' : 'ask'}</Chip>}
          <p className={`min-w-0 flex-1 truncate text-sm ${hot ? 'font-medium text-accent' : ''}`}>{title}</p>
          {due ? <span className={`shrink-0 text-xs ${hot ? 'font-medium text-accent' : 'text-warn'}`}>{due}</span> : null}
        </summary>

        <div className="flex flex-col gap-2.5 px-4 pb-3.5 pl-[3.6rem] sm:px-5 sm:pl-[4.1rem]">
          {detail ? <p className="text-sm text-muted">{detail}</p> : null}

          <div className="flex flex-wrap gap-2">
            {yes ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => submit(yes.answer)}
                className="basis-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg disabled:opacity-40 sm:basis-auto"
              >
                {pending ? 'Adding…' : yes.label}
              </button>
            ) : null}
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={kind === 'TODO' ? 'Note what you did…' : 'Answer…'}
              disabled={pending}
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm
                         outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && answer.trim() && !pending) submit()
              }}
            />
            <button
              type="button"
              disabled={pending || !answer.trim()}
              onClick={() => submit()}
              className="shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg
                         disabled:opacity-40"
            >
              {pending ? 'Saving…' : 'Answer'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => { await dismissItem(id); finish('dismissed.') })}
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
