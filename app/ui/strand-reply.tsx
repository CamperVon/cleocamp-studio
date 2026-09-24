'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { answerItem, dismissItem, tellProductStage } from '@/app/(main)/items/actions'

/**
 * A line in a product row that can be answered where it sits.
 *
 * Brandon, 24 Sept 2026: "being able to respond to these TODOs would be
 * helpful without cluttering the UI." So the line looks exactly as it did
 * until it is tapped; only then does a box open under it. The answer goes
 * through Mouse (answerItem / tellProductStage), which closes the item and
 * applies what the answer implies, and Mouse's own one-line account of what it
 * changed is shown in place of the box.
 */
export function StrandReply({
  text,
  className,
  itemId,
  productId,
}: {
  text: string
  className: string
  itemId?: string
  productId?: string
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  const send = () =>
    start(async () => {
      const r = itemId ? await answerItem(itemId, value) : productId ? await tellProductStage(productId, value) : null
      setReply(r ?? 'Done.')
      setValue('')
      router.refresh()
    })
  const done = () =>
    start(async () => {
      if (itemId) await dismissItem(itemId)
      setReply('Marked done.')
      router.refresh()
    })

  return (
    <span className="min-w-0 flex-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`text-left hover:underline ${className}`}>
        {text}
      </button>
      {reply ? (
        <span className="mt-1 block text-accent">{reply}</span>
      ) : open ? (
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() && !pending) send() }}
            placeholder={itemId ? 'Answer or update…' : 'Where is it now?'}
            disabled={pending}
            className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs text-ink"
          />
          <button
            type="button"
            onClick={send}
            disabled={pending || !value.trim()}
            className="rounded bg-ink px-2 py-1 text-[11px] font-medium text-bg disabled:opacity-40"
          >
            {pending ? 'Sending…' : 'Send'}
          </button>
          {itemId ? (
            <button type="button" onClick={done} disabled={pending} className="rounded border border-line px-2 py-1 text-[11px] text-muted">
              Done
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}
