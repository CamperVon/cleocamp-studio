'use client'
import { useState, useTransition } from 'react'
import { addCaseNote, applyAddressAndReply, redraftReply, removeUnshippedItem, sendReply, setCaseStatus } from '@/app/(main)/support/actions'
import { mentionsDiscount, unfilled } from '@/lib/support/reply'

type Msg = { id: string; direction: 'INBOUND' | 'OUTBOUND' | 'NOTE'; fromAddress: string | null; body: string; at: string }
type Order = {
  name: string; createdAt: string; financialStatus: string | null; fulfillmentStatus: string | null; total: string | null
  items: Array<{ title: string; variant: string | null; quantity: number; id?: string; unfulfilled?: number }>
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
  draft: {
    reply: string | null
    needs: string | null
    address: { to: Addr; from: Addr | null; problems: string[] } | null
    at: string
  } | null
}

type Addr = {
  name: string | null; address1: string | null; address2: string | null
  city: string | null; provinceCode: string | null; zip: string | null; countryCode: string | null
}

const addrLines = (a: Addr | null) =>
  a ? [a.name, a.address1, a.address2, [a.city, a.provinceCode, a.zip].filter(Boolean).join(' ')].filter(Boolean) : ['—']

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
 * sends anything to the customer except the Send buttons in the reply box,
 * each a person's tap (phase 2, 24 Sept 2026).
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
              <span className="font-normal text-muted"> · {c.category}{c.orderName ? ` · ${c.orderName}` : ''}{c.draft?.reply && c.status !== 'RESOLVED' ? ' · reply drafted' : ''}</span>
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
                <OrderLine key={n} caseId={c.id} item={i} open={c.status !== 'RESOLVED'} />
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

          {c.status !== 'RESOLVED' ? <ReplyBox c={c} /> : null}

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

/**
 * The drafted reply. Editable; sent only by a tap. The server re-checks the
 * gaps and, for an address change, the order itself — the disabled buttons
 * here are a convenience, not the guard.
 */
function ReplyBox({ c }: { c: CaseView }) {
  const d = c.draft
  const [text, setText] = useState(d?.reply ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!d) {
    return (
      <div className="rounded border border-dashed border-line px-3 py-2 text-xs text-muted">
        No reply drafted yet.{' '}
        <button type="button" disabled={pending} onClick={() => start(() => redraftReply(c.id))} className="underline">
          {pending ? 'Drafting…' : 'Draft a reply'}
        </button>
      </div>
    )
  }
  if (!d.reply) {
    return (
      <p className="rounded border border-dashed border-line px-3 py-2 text-xs text-muted">
        Mouse: no reply needed — close it once you have read it.
      </p>
    )
  }

  const gaps = unfilled(text)
  const a = d.address
  const canMove = !!a && !a.problems.length
  const blocked = pending || !!gaps.length || !text.trim()
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setMsg(null)
      const r = await fn()
      setMsg(r.ok ? 'Sent.' : r.error)
    })

  return (
    <div className="flex flex-col gap-2 rounded border border-line bg-bg px-3 py-2.5">
      <p className="text-[11px] text-faint">Reply drafted by Mouse. Nothing is sent until you tap Send. Signs as Cleo Studio.</p>

      {d.needs ? <p className="text-xs font-medium text-urgent">Needs you: {d.needs}</p> : null}
      {mentionsDiscount(text) ? <p className="text-xs text-muted">Includes the CLEOFRIEND code (10% off).</p> : null}

      {a ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-faint">Ships to now</p>
            {addrLines(a.from).map((l, i) => <p key={i} className="text-muted">{l}</p>)}
          </div>
          <div>
            <p className="text-faint">Customer asks for</p>
            {addrLines(a.to).map((l, i) => <p key={i} className="font-medium">{l}</p>)}
          </div>
          <p className={`col-span-2 ${a.problems.length ? 'text-urgent' : 'text-muted'}`}>
            {a.problems.length
              ? a.problems.join(' ')
              : 'Checks passed: sent from the email on the order, and it has not shipped. Checked again when you tap.'}
          </p>
        </div>
      ) : null}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(14, Math.max(6, text.split('\n').length + 1))}
        className="w-full rounded border border-line bg-bg px-2.5 py-2 text-sm leading-relaxed"
      />
      {gaps.length ? <p className="text-xs text-urgent">Fill in {gaps.map((g) => `[${g}]`).join(', ')} before sending.</p> : null}

      <div className="flex flex-wrap gap-2">
        {canMove ? (
          <button
            type="button" disabled={blocked}
            onClick={() => run(() => applyAddressAndReply(c.id, text))}
            className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-bg disabled:opacity-40"
          >
            {pending ? 'Working…' : 'Update address & send'}
          </button>
        ) : null}
        <button
          type="button" disabled={blocked}
          onClick={() => run(() => sendReply(c.id, text))}
          className={`rounded px-2.5 py-1.5 text-xs font-medium disabled:opacity-40 ${canMove ? 'border border-line' : 'bg-accent text-bg'}`}
        >
          {canMove ? 'Send reply only' : pending ? 'Sending…' : 'Send reply'}
        </button>
        <button
          type="button" disabled={pending}
          onClick={() => start(async () => { await redraftReply(c.id); setMsg('Redrafted — reload to see it.') })}
          className="rounded border border-line px-2.5 py-1.5 text-xs text-muted"
        >
          Redraft
        </button>
      </div>
      {msg ? <p className="text-xs text-muted">{msg}</p> : null}
    </div>
  )
}

/**
 * One item on the order. An item that has not shipped can be taken off —
 * Shopify will not cancel part of a partly-shipped order, but it will remove
 * the unshipped units, which is what gets them off the packing list. Asks
 * first; the refund stays a person's tap in Shopify.
 */
function OrderLine({ caseId, item, open }: {
  caseId: string
  item: { title: string; variant: string | null; quantity: number; id?: string; unfulfilled?: number }
  open: boolean
}) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const label = `${item.title}${item.variant ? ` — ${item.variant}` : ''}`
  const removable = open && !!item.id && !!item.unfulfilled
  return (
    <div>
      <p>
        {item.quantity} × {label}
        {item.unfulfilled === 0 ? <span className="text-faint"> · shipped</span> : item.unfulfilled ? <span className="text-faint"> · not shipped</span> : null}
        {removable ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Take ${item.unfulfilled} × ${label} off this order? It comes off the packing list and goes back into stock. You send the refund in Shopify.`)) return
              start(async () => {
                const r = await removeUnshippedItem(caseId, item.id!)
                setMsg(r.ok ? (r.note ?? 'Removed.') : r.error)
              })
            }}
            className="ml-2 underline"
          >
            {pending ? 'Removing…' : 'Remove (not shipped)'}
          </button>
        ) : null}
      </p>
      {msg ? <p className="text-ink">{msg}</p> : null}
    </div>
  )
}
