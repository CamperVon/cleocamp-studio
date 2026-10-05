/**
 * Stylists: who has what out on a pull, and what they asked for that we did
 * not have. Brandon, 28 Sept 2026: Cleo forwards stylists' requests; Mouse
 * keeps the record, and writes to them — to ask, to say new stock is in, or
 * to chase a pull that is due back.
 *
 * A pull is a loan. Its pieces leave the shelf as STYLIST_PULL_OUT events and
 * come back as STYLIST_PULL_RETURN, neither of which counts as demand.
 */
import { db } from '@/lib/db'

/** Pieces still out on a pull line. Pure. */
export const stillOut = (l: { qty: number; returnedQty: number }) => Math.max(0, l.qty - l.returnedQty)

/** Pieces a pull still has out. A closed pull (kept, or removed) has none. Pure. */
export const pullOut = (p: { closedAs?: string | null; lines: Array<{ qty: number; returnedQty: number }> }) =>
  p.closedAs ? 0 : p.lines.reduce((n, l) => n + stillOut(l), 0)

export async function loadStylists() {
  const stylists = await db.stylist.findMany({
    orderBy: { name: 'asc' },
    include: {
      // A pull removed as a mistake leaves the page; its history is in the ledger.
      // Spelled out with null: NOT { closedAs: 'REMOVED' } is false in SQL for
      // an open pull (NULL), and hid every one of them.
      pulls: { where: { OR: [{ closedAs: null }, { closedAs: { not: 'REMOVED' } }] }, orderBy: { sentAt: 'desc' }, include: { lines: true } },
      requests: { orderBy: { createdAt: 'desc' } },
    },
  })
  return stylists.map((s) => {
    const out = s.pulls.reduce((n, p) => n + pullOut(p), 0)
    const openPulls = s.pulls.filter((p) => pullOut(p) > 0)
    const due = openPulls.map((p) => p.dueBackAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null
    const openRequests = s.requests.filter((r) => r.status === 'OPEN' || r.status === 'TOLD')
    return { ...s, out, openPulls, due, openRequests }
  })
}

const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })

/**
 * What Mouse is told every turn: pieces out and when they are due, overdue
 * called out, and open requests — with the count now on hand where the
 * request names a variant, so "that's back in stock, tell her" is visible.
 */
export async function stylistContext(now = new Date()): Promise<string> {
  const all = await loadStylists()
  const withPulls = all.filter((s) => s.out > 0)
  const reqs = all.flatMap((s) => s.openRequests.map((r) => ({ s, r })))
  const reserve = await db.product.findMany({ where: { stylistReserveQty: { gt: 0 } }, select: { name: true, stylistReserveQty: true } })
  const { stylistStock, variantLabels, piecesOf, pieceStatus, pieceLine } = await import('@/lib/stylist-stock')
  const inv = await stylistStock()
  if (!all.length && !reserve.length && !inv.size) return ''
  const planned = reqs.flatMap(({ r }) => piecesOf(r.pieces).map((p) => p.productVariantId))
  const labels = await variantLabels([...new Set([...inv.keys(), ...planned])])
  const variantIds = reqs.map(({ r }) => r.productVariantId).filter((x): x is string => !!x)
  const counts = new Map((await db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, onHandQty: true } })).map((v) => [v.id, v.onHandQty]))
  const lines: string[] = ['STYLISTS (the Stylists page)']
  // Every stylist with their id. Without it Mouse filed Natasha Colvin's
  // Adriana Lima pull under Maya, reusing an id it had seen earlier
  // (30 Sept 2026). Use these ids, and pass the name too: the tools check.
  if (all.length) lines.push(`On file: ${all.map((s) => `${s.name} [stylist ${s.id}]`).join('; ')}.`)
  lines.push(inv.size
    ? `Stylist inventory (separate from sales stock): ${[...inv.entries()].map(([id, n]) => `${n} × ${labels.get(id)?.label ?? id} [${id}]`).join('; ')}.`
    : 'Stylist inventory (separate from sales stock): empty so far. A pull from it is short until it is filled in.')
  for (const r of reserve) lines.push(`- Keep ${r.stylistReserveQty} ${r.name}s on hand for stylist pulls; they are not for sale when judging stock or cover.`)
  for (const s of withPulls) {
    const overdue = s.due && s.due < now
    lines.push(`- ${s.name}${s.company ? ` (${s.company})` : ''}: ${s.out} piece${s.out === 1 ? '' : 's'} out${s.due ? `, due back ${day(s.due)}${overdue ? ' — OVERDUE' : ''}` : ', no return date agreed'} [${s.openPulls.map((p) => `pull ${p.id}${p.project ? ` "${p.project}"` : ''}: ${pullOut(p)} out, ${p.dueBackAt ? `due ${day(p.dueBackAt)}` : 'no return date'}`).join('; ')}].`)
  }
  for (const { s, r } of reqs) {
    const c = r.productVariantId ? counts.get(r.productVariantId) : undefined
    lines.push(`- ${s.name} asked for ${r.what}${r.qty ? ` × ${r.qty}` : ''} on ${day(r.createdAt)}${r.status === 'TOLD' ? ' (told it is in stock)' : ''}${c != null ? `; ${String(c)} on hand now` : ''} [request ${r.id}].`)
    const pieces = piecesOf(r.pieces)
    if (pieces.length) for (const st of pieceStatus(pieces, inv, labels)) lines.push(`    · ${pieceLine(st)}`)
    else lines.push('    · Exact pieces not set yet (set_request_pieces once known).')
  }
  return lines.join('\n')
}

/**
 * A request's name for its folded line, from what Mouse wrote about it: the
 * shoot or film in quotes when there is one ("Kendall at Home"), else the
 * first phrase, cut short. Brandon, 5 Oct 2026: the requests need cleaning up
 * "like the out on pulls". Pure.
 */
export function requestTitle(what: string): string {
  const quoted = what.match(/["“]([^"”]{3,60})["”]/)?.[1]
  if (quoted) return quoted.trim()
  const head = what.split(/[:(—;\n]/)[0].trim()
  if (head.length <= 48) return head
  const cut = head.slice(0, 48)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : 48).replace(/[,.\s]+$/, '')}…`
}

/**
 * Which stylist a tool means. By id, by name, or both; when both are given
 * they must agree, which is what would have caught the Natasha pull filed
 * under Maya. A name matches whole or as the start of a word ("Natasha",
 * "Colvin"); more than one match is a question, never a pick. Pure.
 */
export function pickStylist<S extends { id: string; name: string }>(all: S[], id?: string | null, name?: string | null): { stylist: S } | { reason: string } {
  const r = pickNamed('stylist', 'Add them with save_stylist, or check the name.', all, id, name)
  return 'reason' in r ? r : { stylist: r.picked }
}

/**
 * The same match for any named record: by id, by name, or both, where both
 * must agree. A name matches whole or as the start of each word; more than
 * one match is a question, never a pick. Brandon, 5 Oct 2026: Mouse made the
 * Waymo Commercial store, then could not invoice it a message later because
 * the tool took only its id. Pure.
 */
export function pickNamed<S extends { id: string; name: string }>(kind: string, none: string, all: S[], id?: string | null, name?: string | null): { picked: S } | { reason: string } {
  const byId = id ? all.find((s) => s.id === id.trim()) : undefined
  const words = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const want = words(name ?? '')
  const n = want.length ? want.join(' ') : null
  const byName = n ? all.filter((s) => { const w = words(s.name); return want.every((t) => w.some((x) => x.startsWith(t))) }) : []
  if (id && !byId && !n) return { reason: `No ${kind} ${id}. Use an id from the list on file, or give the name.` }
  if (byId && n && !byName.some((s) => s.id === byId.id)) return { reason: `${kind[0].toUpperCase()}${kind.slice(1)} ${id} is ${byId.name}, not ${name}. Check which one is meant.` }
  if (byId) return { picked: byId }
  if (!n) return { reason: `Say which ${kind}.` }
  if (byName.length === 1) return { picked: byName[0] }
  if (!byName.length) return { reason: `No ${kind} called ${name}. ${none}` }
  return { reason: `More than one ${kind} matches ${name}: ${byName.map((s) => s.name).join(', ')}. Ask which.` }
}

/**
 * What a pull actually took off stock and has not had back, per variant,
 * from the ledger: every event carrying its "[pull id]" marker, summed. A
 * line whose write Shopify refused took nothing (the Black size 1 tee on
 * Natasha's Adriana Lima pull), so it gives nothing back. Corrections carry
 * the marker too, so a second removal finds nothing left. Pure.
 */
export function stillTaken(events: Array<{ productVariantId: string | null; deltaQty: number }>): Map<string, number> {
  const net = new Map<string, number>()
  for (const e of events) if (e.productVariantId) net.set(e.productVariantId, (net.get(e.productVariantId) ?? 0) + e.deltaQty)
  for (const [k, v] of net) if (v >= 0) net.delete(k); else net.set(k, -v)
  return net
}
