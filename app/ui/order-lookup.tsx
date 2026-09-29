'use client'
import { useState, useTransition } from 'react'
import { lookupOrder } from '@/app/(main)/support/actions'
import type { OrderStatus } from '@/lib/order-status'

/**
 * Type any order number and see where it stands: paid, shipped, tracking,
 * refunds. Above "A return arrived" on Support. Brandon, 29 Sept 2026.
 * Looks only; changes nothing.
 */
export function OrderLookup() {
  const [num, setNum] = useState('')
  const [o, setO] = useState<OrderStatus | null>(null)
  const [caseId, setCaseId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const look = () => start(async () => {
    setErr(null)
    setO(null)
    const r = await lookupOrder(num)
    if (!r.ok) { setErr(r.error); return }
    setO(r.order)
    setCaseId(r.caseId)
  })

  const bad = (s: string) => /not paid|refund|cancel|unfulfilled|partial/.test(s)
  return (
    <section className="rounded-xl border border-line bg-surface px-4 py-3 sm:px-5">
      <h2 className="font-serif text-[17px] italic text-accent">Look up an order</h2>
      <form onSubmit={(e) => { e.preventDefault(); look() }} className="mt-2 flex gap-2">
        <input
          value={num} onChange={(e) => setNum(e.target.value)} inputMode="numeric" placeholder="Order number, e.g. 2237"
          className="min-w-0 flex-1 rounded border border-line bg-bg px-2.5 py-1.5 text-sm"
        />
        <button type="submit" disabled={pending || !num.trim()} className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40">
          {pending ? 'Looking…' : 'Look up'}
        </button>
      </form>
      {err ? <p className="mt-2 text-sm text-urgent">{err}</p> : null}

      {o ? (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {o.name} <span className="font-normal text-muted">· {o.customer ?? 'no name'} · placed {o.placed}{o.kind !== 'web' ? ` · ${o.kind}` : ''}</span>
            </p>
            <a href={o.adminUrl} target="_blank" rel="noreferrer" className="text-xs text-accent underline">Open in Shopify</a>
          </div>
          <p className="text-xs text-muted">{[o.email, o.shipTo ? `ships to ${o.shipTo}` : null].filter(Boolean).join(' · ')}</p>

          {o.cancelled ? <p className="text-urgent">Cancelled {o.cancelled}.</p> : null}
          <p>
            <span className={bad(o.paid) ? 'text-warn' : ''}>{o.paid[0].toUpperCase() + o.paid.slice(1)}</span>
            {' · '}
            <span className={bad(o.fulfilment) ? 'text-warn' : ''}>{o.fulfilment}</span>
            {' · '}${o.total.toFixed(2)}
            {o.refunded ? <span className="text-warn"> · ${o.refunded.toFixed(2)} refunded{o.refundPending ? ` ($${o.refundPending.toFixed(2)} still pending at the card)` : ''}</span> : null}
          </p>

          <ul className="flex flex-col gap-0.5 border-t border-line pt-2 text-xs">
            {o.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3">
                <span>{i.ordered} × {i.label}</span>
                <span className="shrink-0 text-muted">
                  {i.now < i.ordered ? `${i.ordered - i.now} removed · ` : ''}
                  {i.now === 0 ? 'none left on order' : i.toShip ? `${i.toShip} to ship` : 'shipped'}
                </span>
              </li>
            ))}
          </ul>

          {o.shipments.length ? (
            <ul className="flex flex-col gap-1 border-t border-line pt-2 text-xs">
              {o.shipments.map((s, k) => (
                <li key={k}>
                  <span className="text-muted">Sent {s.date} · {s.delivered ? `delivered ${s.delivered}` : s.status}</span>
                  {s.tracking.map((t, j) => (
                    <span key={j}>
                      {' · '}
                      {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="text-accent underline">{t.company ?? 'Track'} {t.number ?? ''}</a> : `${t.company ?? ''} ${t.number ?? ''}`}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}

          {caseId ? <a href={`#${caseId}`} className="text-xs text-accent underline">This order has a support case</a> : null}
        </div>
      ) : null}
    </section>
  )
}
