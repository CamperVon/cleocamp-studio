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

export async function loadStylists() {
  const stylists = await db.stylist.findMany({
    orderBy: { name: 'asc' },
    include: {
      pulls: { orderBy: { sentAt: 'desc' }, include: { lines: true } },
      requests: { orderBy: { createdAt: 'desc' } },
    },
  })
  return stylists.map((s) => {
    const out = s.pulls.reduce((n, p) => n + p.lines.reduce((m, l) => m + stillOut(l), 0), 0)
    const openPulls = s.pulls.filter((p) => p.lines.some((l) => stillOut(l) > 0))
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
  if (!all.length && !reserve.length) return ''
  const variantIds = reqs.map(({ r }) => r.productVariantId).filter((x): x is string => !!x)
  const counts = new Map((await db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, onHandQty: true } })).map((v) => [v.id, v.onHandQty]))
  const lines: string[] = ['STYLISTS (the Stylists page)']
  // Every stylist with their id. Without it Mouse filed Natasha Colvin's
  // Adriana Lima pull under Maya, reusing an id it had seen earlier
  // (30 Sept 2026). Use these ids, and pass the name too: the tools check.
  if (all.length) lines.push(`On file: ${all.map((s) => `${s.name} [stylist ${s.id}]`).join('; ')}.`)
  for (const r of reserve) lines.push(`- Keep ${r.stylistReserveQty} ${r.name}s on hand for stylist pulls; they are not for sale when judging stock or cover.`)
  for (const s of withPulls) {
    const overdue = s.due && s.due < now
    lines.push(`- ${s.name}${s.company ? ` (${s.company})` : ''}: ${s.out} piece${s.out === 1 ? '' : 's'} out${s.due ? `, due back ${day(s.due)}${overdue ? ' — OVERDUE' : ''}` : ', no return date agreed'} [${s.openPulls.map((p) => `pull ${p.id}${p.project ? ` "${p.project}"` : ''}: ${p.lines.reduce((n, l) => n + stillOut(l), 0)} out, ${p.dueBackAt ? `due ${day(p.dueBackAt)}` : 'no return date'}`).join('; ')}].`)
  }
  for (const { s, r } of reqs) {
    const c = r.productVariantId ? counts.get(r.productVariantId) : undefined
    lines.push(`- ${s.name} asked for ${r.what}${r.qty ? ` × ${r.qty}` : ''} on ${day(r.createdAt)}${r.status === 'TOLD' ? ' (told it is in stock)' : ''}${c != null ? `; ${String(c)} on hand now` : ''} [request ${r.id}].`)
  }
  return lines.join('\n')
}

/**
 * Which stylist a tool means. By id, by name, or both; when both are given
 * they must agree, which is what would have caught the Natasha pull filed
 * under Maya. A name matches whole or as the start of a word ("Natasha",
 * "Colvin"); more than one match is a question, never a pick. Pure.
 */
export function pickStylist<S extends { id: string; name: string }>(all: S[], id?: string | null, name?: string | null): { stylist: S } | { reason: string } {
  const byId = id ? all.find((s) => s.id === id.trim()) : undefined
  const words = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const want = words(name ?? '')
  const n = want.length ? want.join(' ') : null
  const byName = n ? all.filter((s) => { const w = words(s.name); return want.every((t) => w.some((x) => x.startsWith(t))) }) : []
  if (id && !byId) return { reason: `No stylist ${id}. Use an id from the list of stylists on file.` }
  if (byId && n && !byName.some((s) => s.id === byId.id)) return { reason: `Stylist ${id} is ${byId.name}, not ${name}. Check which one is meant.` }
  if (byId) return { stylist: byId }
  if (!n) return { reason: 'Say which stylist.' }
  if (byName.length === 1) return { stylist: byName[0] }
  if (!byName.length) return { reason: `No stylist called ${name}. Add them with save_stylist, or check the name.` }
  return { reason: `More than one stylist matches ${name}: ${byName.map((s) => s.name).join(', ')}. Ask which.` }
}
