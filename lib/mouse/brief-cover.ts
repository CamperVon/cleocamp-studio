/**
 * Whether what is on order covers what is short, worked out by code for the
 * morning brief. Brandon, 7 Oct 2026: the brief said of the Cleo Tee "I can't
 * see whether PO 2360 covers the backlog plus new orders". It couldn't: it
 * was given each size's stock and the PO lines but no sales by size, and is
 * told never to invent a number. So the sum is done here and handed over as a
 * fact, the same way money is worked out by Shopify and never by Mouse.
 *
 * Dates are day-only values at UTC midnight, as laMidnight() and a PO's
 * expectedAt both are, so day counts and labels read in UTC. Pure.
 */

const DAY = 864e5

export type CoverInput = {
  label: string
  onHand: number
  /** Units a day, from the forecast's own measure (lib/forecast.ts ratePerDay). */
  perDay: number
  /** What is still to come on open purchase orders for exactly this variant. */
  incoming: Array<{ po: string; qty: number; due: Date | null }>
}

const dayLabel = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const rate = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1))

export function coverLine(v: CoverInput, today: Date): string {
  const now = `${v.label}: ${v.onHand} now`
  const selling = v.perDay > 0 ? `selling about ${rate(v.perDay)} a day` : 'no recent sales'
  const due = v.incoming.filter((i) => i.qty > 0)
  const dated = due.filter((i): i is { po: string; qty: number; due: Date } => !!i.due).sort((a, b) => +a.due - +b.due)
  const undated = due.filter((i) => !i.due)
  const undatedQty = undated.reduce((n, i) => n + i.qty, 0)
  const noDate = undatedQty ? ` ${undatedQty} more on order (PO ${[...new Set(undated.map((i) => i.po))].join(', ')}) with no date confirmed.` : ''
  if (!dated.length) return `${now}, ${selling}. ${undatedQty ? 'Nothing on order with a date.' : 'Nothing on order.'}${noDate}`

  const first = +dated[0].due
  const next = dated.filter((i) => +i.due === first)
  const qty = next.reduce((n, i) => n + i.qty, 0)
  const days = Math.max(0, Math.round((first - +today) / DAY))
  const sold = Math.round(v.perDay * days)
  const after = v.onHand - sold + qty
  const pos = [...new Set(next.map((i) => i.po))].join(', ')
  const when = days === 0 ? 'due today or overdue' : `due ${dayLabel(dated[0].due)}`
  const outcome = after >= 0 ? `about ${after} left once it lands` : `still about ${-after} short once it lands`
  const later = dated.filter((i) => +i.due !== first)
  const laterText = later.length ? ` Then ${later.reduce((n, i) => n + i.qty, 0)} more due later (${later.map((i) => `PO ${i.po}, ${dayLabel(i.due)}`).join('; ')}).` : ''
  return `${now}, ${selling}. ${qty} ${when} on PO ${pos}; about ${sold} more sell before then, so ${outcome}.${laterText}${noDate}`
}
