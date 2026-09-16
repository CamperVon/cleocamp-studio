import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'
import { poLineLabel, poUnitTotals } from '@/lib/po'

/**
 * What is happening to each product, gathered in one place.
 *
 * The facts were never missing. For the 5to7 Skirt alone the app held eighteen
 * notes, a calendar entry saying 18 pieces land on the 25th for the 27 Sept
 * sale, PO 2362, and two open questions — filed by date, by PO number and by
 * entity, so answering "where is the skirt" meant visiting four screens and
 * holding it together in your head. Nothing here is new information. It is the
 * same rows, joined by the thing Jane actually thinks in: the product.
 *
 * NOTHING IS WRITTEN AS PROSE THAT IS NOT BACKED BY A ROW. Every line below
 * comes from a record with a date, and carries the date, so a summary that has
 * gone stale looks stale rather than reading as confident and current. Cleo,
 * 16 Sept 2026: "I definitely don't want to repeat the pattern of Mouse
 * overstating a bunch of noise or stating things that are out of date."
 */

export type Strand = {
  kind: 'order' | 'run' | 'date' | 'waiting'
  text: string
  /** Absolute, so a reader can see how old the claim is. */
  on: Date | null
  /** Overdue, or blocking something. */
  flag: boolean
  href?: string
}

export type ProductState = {
  id: string
  name: string
  /** One or two sentences, assembled from the strands — never invented. */
  headline: string
  strands: Strand[]
  flag: boolean
  onHand: number | null
  asOf: Date
}

const day = (d: Date) => d.toISOString().slice(0, 10)

export async function buildProductionView(): Promise<ProductState[]> {
  const today = laMidnight(0)

  const [pos, runs, events, items, products] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
      include: {
        vendor: true,
        lines: { include: { component: true, productVariant: { include: { product: true, colorway: true } } } },
      },
    }),
    db.productionRun.findMany({
      where: { status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      include: { product: true, vendor: true },
    }),
    db.calendarEvent.findMany({
      // ORDER_BY entries are the forecast talking to itself — six "Order Cleo
      // Tee" rows, each quoting a different stock figure from the day it was
      // written. They already surface as alerts. Repeating them here would
      // bury the one line that is actually news (18 skirts land on the 25th)
      // under the app's own chatter.
      where: { productId: { not: null }, date: { gte: laMidnight(3) }, type: { not: 'ORDER_BY' } },
      orderBy: { date: 'asc' },
    }),
    db.actionItem.findMany({
      where: { resolved: false, entityType: 'PRODUCT', entityId: { not: null } },
      orderBy: { createdAt: 'asc' },
    }),
    db.product.findMany({ include: { variants: true } }),
  ])

  const byId = new Map(products.map((p) => [p.id, p]))
  const strands = new Map<string, Strand[]>()
  const add = (pid: string | null | undefined, s: Strand) => {
    if (!pid || !byId.has(pid)) return
    strands.set(pid, [...(strands.get(pid) ?? []), s])
  }

  // ── Orders ────────────────────────────────────────────────
  for (const po of pos) {
    // A line reaches its product through its variant; a described line falls
    // back to the order's own forProduct. Component lines are the cloth and
    // trim to make the thing, and belong to the order, not to a product's
    // progress — counting them here is how 700 yards of rib once read as 700
    // finished tees.
    const touched = new Set<string>()
    for (const l of po.lines) {
      const pid = l.productVariant?.product.id ?? (l.componentId === null ? po.forProductId : null)
      if (pid) touched.add(pid)
    }
    if (!touched.size && po.forProductId) touched.add(po.forProductId)

    for (const pid of touched) {
      const mine = po.lines.filter(
        (l) => (l.productVariant?.product.id ?? (l.componentId === null ? po.forProductId : null)) === pid,
      )
      // A TOTAL, not a recital. Spelling out every line turned PO 2360 into a
      // paragraph of eighteen clauses — "60 pcs Cleo Tee / Shell / 1, 50 pcs
      // Cleo Tee / Shell / 2, ..." — which is the order sheet, not a status.
      // The full breakdown is one tap away on the PO itself.
      const use = mine.length ? mine : po.lines
      const totals = poUnitTotals(use).map((t) => `${t.qty.toLocaleString()} ${t.unit}`).join(' + ')
      const what =
        use.length === 1
          ? `${use[0].qtyOrdered} ${use[0].unit} ${poLineLabel(use[0])}`
          : `${totals} across ${use.length} lines`
      const overdue = !!po.expectedAt && po.expectedAt < today && po.status !== 'PARTIALLY_RECEIVED'
      add(pid, {
        kind: 'order',
        text:
          po.status === 'DRAFT'
            ? `PO ${po.poNumber} · ${po.vendor.name} · ${what} — DRAFT, not sent yet`
            : `PO ${po.poNumber} · ${po.vendor.name} · ${what}` +
              (po.expectedAt ? ` — due ${day(po.expectedAt)}${overdue ? ', passed' : ''}` : ' — no date confirmed'),
        on: po.expectedAt ?? po.orderedAt,
        flag: overdue || po.status === 'DRAFT',
        href: `/po/${po.poNumber}`,
      })
    }
  }

  // ── Runs at a maker ───────────────────────────────────────
  for (const r of runs) {
    const late = !!r.expectedReadyAt && r.expectedReadyAt < today
    add(r.productId, {
      kind: 'run',
      text:
        (r.statusSummary ?? `${r.status.toLowerCase().replace(/_/g, ' ')} at ${r.vendor?.name ?? 'a maker not yet set'}`) +
        (r.expectedReadyAt
          ? ` — ready ${day(r.expectedReadyAt)}${r.dateConfirmed ? '' : ' (unconfirmed)'}${late ? ', passed' : ''}`
          : ' — no ready date'),
      on: r.expectedReadyAt,
      flag: late,
    })
  }

  // ── Dates someone has put in the calendar ─────────────────
  for (const e of events) {
    add(e.productId, {
      kind: 'date',
      // Title only. The notes behind these run to several sentences and turned
      // each date into a paragraph; they are on the calendar for anyone who
      // wants them.
      text: `${day(e.date)} · ${e.title}`,
      on: e.date,
      // A calendar entry is never a flag. It records that something is due to
      // happen, and carries no field saying whether it did — "cosmo sample
      // yardage picked up" is a completed pickup sitting in the past under the
      // DELIVERY_EXPECTED type, because everything off the logistics feed gets
      // that type. Flagging on date alone painted history red and taught the
      // reader to ignore red. Lateness is judged where it can actually be
      // known: an order with a status, a run with a ready date, a todo with a
      // due date.
      flag: false,
    })
  }

  // ── What is waiting on a person ───────────────────────────
  for (const i of items) {
    const overdue = !!i.dueDate && i.dueDate < today
    add(i.entityId, {
      kind: 'waiting',
      text: i.title + (i.dueDate ? ` (due ${day(i.dueDate)}${overdue ? ', overdue' : ''})` : ''),
      on: i.dueDate ?? i.createdAt,
      // An open question is NOT a red flag. Nearly every product has one, and
      // if everything is red then red says nothing — which is exactly the noise
      // Cleo asked us not to recreate. Red means a date has passed or an order
      // has not gone out, never that something is merely still unknown.
      flag: overdue,
      href: '/items',
    })
  }

  // ── Assemble ──────────────────────────────────────────────
  const out: ProductState[] = []
  for (const [pid, list] of strands) {
    // "In production" means something is being made or bought. A product whose
    // only entry is an unanswered question is not in production, it is on the
    // questions list — and putting it here would pad the tab with rows that
    // never change.
    if (!list.some((s) => s.kind === 'order' || s.kind === 'run')) continue
    const p = byId.get(pid)!

    // Where the goods PHYSICALLY are — at the cutter, at the dye house, in
    // finishing — lives on a ProductionRun, and most products have none, so
    // the honest answer is that nobody has said. Printing that is the point:
    // a row that stops at "on order, due the 25th" reads as though that is the
    // whole story, when really nothing is tracking the journey. Cleo, 17 Sept:
    // "we do need to understand when things are at the dye house... it doesn't
    // need to break dates, just keep us in the loop."
    if (!list.some((s) => s.kind === 'run')) {
      list.push({
        kind: 'run',
        text: 'No stage recorded — nobody has said where this physically is. Tell Mouse and it will keep it here.',
        on: null,
        flag: false,
      })
    }
    const anyUnknown = p.variants.some((v) => v.onHandQty === null)
    const onHand = anyUnknown
      ? null
      : p.variants.reduce((n, v) => n + Number(v.onHandQty ?? 0), 0)

    // Order: what is blocked or late first, then by date.
    list.sort((a, b) => Number(b.flag) - Number(a.flag) || (a.on?.getTime() ?? 0) - (b.on?.getTime() ?? 0))

    const orders = list.filter((s) => s.kind === 'order')
    const waiting = list.filter((s) => s.kind === 'waiting')
    const nextDate = list.filter((s) => s.kind === 'date' && s.on && s.on >= today).sort(
      (a, b) => a.on!.getTime() - b.on!.getTime())[0]

    // The headline is stitched from the strands above, never written freehand.
    const bits: string[] = []
    const drafts = orders.filter((o) => o.text.includes('still a DRAFT'))
    const live = orders.length - drafts.length
    if (live) bits.push(`${live} order${live === 1 ? '' : 's'} open`)
    if (drafts.length) bits.push(`${drafts.length} still a draft`)
    if (nextDate) bits.push(`next date ${day(nextDate.on!)}`)
    if (waiting.length) bits.push(`${waiting.length} waiting on someone`)

    out.push({
      id: pid,
      name: p.name,
      headline: bits.length ? bits.join(' · ') : 'In flight.',
      strands: list,
      flag: list.some((s) => s.flag),
      onHand,
      asOf: new Date(),
    })
  }

  // Trouble first, then alphabetical so the list does not reshuffle daily.
  out.sort((a, b) => Number(b.flag) - Number(a.flag) || a.name.localeCompare(b.name))
  return out
}
