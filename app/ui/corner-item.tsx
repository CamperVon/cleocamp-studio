'use client'
import { useState, useTransition, type ReactNode } from 'react'
import { emailCornerItem, type Teammate } from '@/app/(main)/corner-actions'

/**
 * One item in Mouse's Corner, folded: the item on the closed line, and
 * opened, a way to email it to Cleo, Jane or Brandon (Brandon, 2 Oct 2026).
 */
export function CornerItem({ text, children, dot }: { text: string; children: ReactNode; dot?: boolean }) {
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const [pending, start] = useTransition()
  const send = (to: Teammate) => start(async () => {
    setMsg(null)
    const r = await emailCornerItem(to, text, note)
    setMsg(r.ok ? { text: r.message, bad: false } : { text: r.error, bad: true })
    if (r.ok) setNote('')
  })
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-baseline gap-2.5 px-4 py-2 text-sm hover:bg-sunk sm:px-5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full ${dot ? 'bg-urgent' : 'bg-transparent'}`} />
        <span className="min-w-0 flex-1">{children}</span>
        <span aria-hidden className="shrink-0 text-xs text-faint transition-transform group-open:rotate-90">▸</span>
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-3 pl-8 sm:px-5 sm:pl-9">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" className="w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-1.5 text-xs" />
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Email to</span>
          {(['cleo', 'jane', 'brandon'] as const).map((t) => (
            <button key={t} type="button" disabled={pending} onClick={() => send(t)}
              className="rounded-lg border border-line px-2.5 py-1 capitalize disabled:opacity-40">{pending ? '…' : t}</button>
          ))}
        </span>
        {msg ? <p className={`text-xs ${msg.bad ? 'font-medium text-urgent' : 'text-muted'}`}>{msg.text}</p> : null}
      </div>
    </details>
  )
}
