'use client'
import { useState, useTransition } from 'react'
import { addCaseNote, setCaseStatus } from '@/app/(main)/support/actions'

type Msg = { id: string; direction: 'INBOUND' | 'OUTBOUND' | 'NOTE'; fromAddress: string | null; body: string; at: string }
type Order = {
  name: string; createdAt: string; financialStatus: string | null; fulfillmentStatus: string | null; total: string | null
  items: Array<{ title: string; variant: string | null; quantity: number }>
  tracking: Array<{ company: string | null; number: string | null; url: string | null }>
} | null

export type CaseView = {
  id: string
  who: string
  customerEmail: string
  category: string
  urgency: 'NOW' | 'TODAY' | 'DIGEST'
  status: 'OPEN' | 'WAITING_ON_CUSTOMER' | 'WAITING_ON_RETURN' | 'RESOLVED'
  summary: string | null
  subject: string | null
  orderName: string | null
  order: Order
  age: string
  messages: Msg[]
}

const STATUS_LABEL = {
  OPEN: 'Open',
  WAITING_ON_CUSTOMER: 'Waiting on customer',
  WAITING_ON_RETURN: 'Waiting on return',
  RESOLVED: 'Closed',
} as const

const day = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * One customer conversation. Everything here is for the team: what the
 * customer said, their order, and where the case stands. Nothing on this card
 * sends anything to the customer — that is phase 2, and it will need a tap.
 */
export function SupportCase({ c }: { c: CaseView }) {
  const [pending, start] = useTransition()
  const [note, setNote] = useState('')

  const move = (s: CaseView['status']) => start(() => setCaseStatus(c.id, s))
  return (
    <li id={c.id}>
      <details className="group">
        <summary className="flex cursor-pointer items-start gap-2.5 px-4 py-3 hover:bg-sunk sm:px-5">
          <span
            aria-hidden
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c.urgency === 'NOW' && c.status !== 'RESOLVED' ? 'bg-urgent' : 'bg-transparent'}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {c.who}
              <span className="font-normal text-muted"> · {c.category}{c.orderName ? ` · ${c.orderName}` : ''}</span>
            </p>
            <p className="text-xs leading-snug text-muted">{c.summary ?? c.subject ?? '(no summary)'}</p>
          </div>
          <p className="shrink-0 text-right text-xs text-faint">
            {c.age}
            {c.status !== 'OPEN' ? <span className="block">{STATUS_LABEL[c.status]}</span> : null}
          </p>
        </summary>

        <div className="flex flex-col gap-3 border-t border-line bg-sunk/40 px-4 py-3 sm:px-5">
          <p className="text-xs text-muted">{c.customerEmail}{c.subject ? ` · "${c.subject}"` : ''}</p>

          {c.order ? (
            <div className="text-xs text-muted">
              <p className="font-medium text-ink">
                Order {c.order.name} · {c.order.createdAt.slice(0, 10)} · {[c.order.financialStatus, c.order.fulfillmentStatus].filter(Boolean).join(' / ').toLowerCase()}
                {c.order.total ? ` · ${c.order.total}` : ''}
              </p>
              {c.order.items.map((i, n) => (
                <p key={n}>{i.quantity} × {i.title}{i.variant ? ` — ${i.variant}` : ''}</p>
              ))}
              {c.order.tracking.map((t, n) =>
                t.url ? (
                  <a key={n} href={t.url} target="_blank" rel="noreferrer" className="underline">
                    Tracking{t.company ? ` (${t.company})` : ''}{t.number ? ` ${t.number}` : ''}
                  </a>
                ) : null,
              )}
            </div>
          ) : null}

          <ul className="flex flex-col gap-2">
            {c.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded border px-3 py-2 text-sm ${m.direction === 'NOTE' ? 'border-dashed border-line text-muted' : 'border-line bg-bg'}`}
              >
                <p className="mb-1 text-[11px] text-faint">
                  {m.direction === 'NOTE' ? `Note${m.fromAddress ? ` — ${m.fromAddress}` : ''}` : m.direction === 'INBOUND' ? 'Customer' : 'Sent'} · {day(m.at)}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            {c.status !== 'WAITING_ON_CUSTOMER' && c.status !== 'RESOLVED' ? (
              <button type="button" disabled={pending} onClick={() => move('WAITING_ON_CUSTOMER')} className="rounded border border-line px-2.5 py-1.5 text-xs">
                Waiting on customer
              </button>
            ) : null}
            {c.status !== 'WAITING_ON_RETURN' && c.status !== 'RESOLVED' ? (
              <button type="button" disabled={pending} onClick={() => move('WAITING_ON_RETURN')} className="rounded border border-line px-2.5 py-1.5 text-xs">
                Waiting on return
              </button>
            ) : null}
            {c.status !== 'RESOLVED' ? (
              <button type="button" disabled={pending} onClick={() => move('RESOLVED')} className="rounded bg-ink px-2.5 py-1.5 text-xs font-medium text-bg">
                Close
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={() => move('OPEN')} className="rounded border border-line px-2.5 py-1.5 text-xs">
                Reopen
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note for the team (not sent)"
              className="min-w-0 flex-1 rounded border border-line bg-bg px-2.5 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={pending || !note.trim()}
              onClick={() => start(async () => { await addCaseNote(c.id, note); setNote('') })}
              className="shrink-0 rounded border border-line px-2.5 py-1.5 text-xs disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </details>
    </li>
  )
}
