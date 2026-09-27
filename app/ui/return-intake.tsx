'use client'
import { useState, useTransition } from 'react'
import { lookupReturn, receiveReturn, type ReturnLookup } from '@/app/(main)/support/actions'

/**
 * "A return arrived": type the order number, tick what came back, say refund
 * or exchange, and the customer is told it landed. Brandon, 27 Sept 2026.
 * The refund itself is a second tap on the case, once someone has checked
 * the item (see app/ui/support-case.tsx).
 */
export function ReturnIntake({ orderName, compact }: { orderName?: string; compact?: boolean } = {}) {
  const [num, setNum] = useState(orderName ?? '')
  const [found, setFound] = useState<Extract<ReturnLookup, { ok: true }> | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [kind, setKind] = useState<'REFUND' | 'EXCHANGE'>('REFUND')
  const [msg, setMsg] = useState<{ text: string; bad: boolean; caseId?: string } | null>(null)
  const [pending, start] = useTransition()

  const look = () => start(async () => {
    setMsg(null)
    setFound(null)
    const r = await lookupReturn(num)
    if (!r.ok) { setMsg({ text: r.error, bad: true }); return }
    setFound(r)
    setQty(Object.fromEntries(r.order.items.map((i) => [i.id, i.returnable])))
  })
  const receive = () => start(async () => {
    if (!found) return
    const r = await receiveReturn({ orderName: found.order.name, kind, lines: found.order.items.map((i) => ({ lineItemId: i.id, quantity: qty[i.id] ?? 0 })) })
    if (!r.ok) { setMsg({ text: r.error, bad: true }); return }
    setMsg({
      text: kind === 'REFUND'
        ? `${found.order.name}: received and the customer emailed. The refund waits on the case for someone to approve.`
        : `${found.order.name}: received, the customer emailed, and the case closed. Send the replacement.`,
      bad: false, caseId: r.caseId,
    })
    setFound(null)
    setNum('')
  })

  const any = found && found.order.items.some((i) => (qty[i.id] ?? 0) > 0)
  return (
    <section className={compact ? 'rounded border border-line bg-bg px-3 py-2 text-xs' : 'rounded-xl border border-line bg-surface px-4 py-3 sm:px-5'}>
      {compact ? (
        found ? null : (
          <button type="button" onClick={look} disabled={pending} className="rounded bg-accent px-2.5 py-1.5 font-medium text-bg disabled:opacity-40">
            {pending ? 'Looking…' : `The return for ${orderName} arrived`}
          </button>
        )
      ) : (
        <h2 className="font-serif text-[17px] italic text-accent">A return arrived</h2>
      )}
      <form onSubmit={(e) => { e.preventDefault(); look() }} className={compact ? 'hidden' : 'mt-2 flex gap-2'}>
        <input
          value={num} onChange={(e) => setNum(e.target.value)} inputMode="numeric" placeholder="Order number, e.g. 2237"
          className="min-w-0 flex-1 rounded border border-line bg-bg px-2.5 py-1.5 text-sm"
        />
        <button type="submit" disabled={pending || !num.trim()} className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40">
          {pending && !found ? 'Looking…' : 'Look up'}
        </button>
      </form>

      {found ? (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p className="text-muted">
            {found.order.name} · {found.order.customerName ?? 'no name'} · {found.order.email ?? 'no email'}
            {found.caseId ? ' · has a support case' : ' · no case yet, one will be made'}
          </p>
          {found.alreadyReceived ? <p className="text-urgent">A return on this order was already marked received and is waiting on its refund.</p> : null}
          <p className="text-xs text-faint">What came back</p>
          <ul className="flex flex-col gap-1.5">
            {found.order.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span>{i.label}</span>
                <select
                  value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })}
                  className="rounded border border-line bg-bg px-1.5 py-1 text-sm"
                >
                  {Array.from({ length: i.returnable + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5"><input type="radio" checked={kind === 'REFUND'} onChange={() => setKind('REFUND')} /> Refund (10% fee)</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={kind === 'EXCHANGE'} onChange={() => setKind('EXCHANGE')} /> Exchange</label>
          </div>
          <button type="button" onClick={receive} disabled={pending || !any} className="self-start rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40">
            {pending ? 'Working…' : 'Mark received & email customer'}
          </button>
        </div>
      ) : null}

      {msg ? (
        <p className={`mt-2 text-sm ${msg.bad ? 'font-medium text-urgent' : 'text-muted'}`}>
          {msg.text} {msg.caseId ? <a href={`/support#${msg.caseId}`} className="underline">Open the case</a> : null}
        </p>
      ) : null}
    </section>
  )
}
