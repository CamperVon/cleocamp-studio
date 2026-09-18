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
  /** Soonest upcoming date across every strand — what the list sorts on. */
  sortDate: Date | null
}

const day = (d: Date) => d.toISOString().slice(0, 10)

// Cleo, 17 Sept 2026: "anything urgent, let's say within 3 days, should be
// red... any outstanding issue imminent to production needs to be at top of
// list and in red." Applied uniformly to every dated strand — an order's due
// date, a run's ready date, a calendar date, a todo's due date — so the
// reader learns one rule (red means now or very soon) rather than a
// different threshold per kind. A 'waiting' item can override this per-item
// via its own remindDaysBefore, which already existed for exactly this and
// defaults to the same 3.
export const URGENT_WINDOW_DAYS = 3

export async function buildProductionView(): Promise<ProductState[]> {
  const today = laMidnight(0)
  const urgentCutoff = laMidnight(-URGENT_WINDOW_DAYS)

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
      const dueSoon = !!po.expectedAt && po.expectedAt >= today && po.expectedAt <= urgentCutoff
      // Red means something is wrong. A purchase order being reviewed
      // internally is not wrong — Brandon, 18 Sept 2026: "Sometimes they are
      // going to be drafts for a minute as they are being reviewed
      // internally." It still says DRAFT in its line either way; what waits
      // for the three days is the colour.
      const staleDraft =
        po.status === 'DRAFT' &&
        po.createdAt < laMidnight(URGENT_WINDOW_DAYS)
      add(pid, {
        kind: 'order',
        text:
          po.status === 'DRAFT'
            ? `PO ${po.poNumber} · ${po.vendor.name} · ${what} — DRAFT, not sent yet`
            : `PO ${po.poNumber} · ${po.vendor.name} · ${what}` +
              (po.expectedAt ? ` — due ${day(po.expectedAt)}${overdue ? ', passed' : ''}` : ' — no date confirmed'),
        on: po.expectedAt ?? po.orderedAt,
        flag: overdue || dueSoon || staleDraft,
        href: `/po/${po.poNumber}`,
      })
    }
  }

  // ── Runs at a maker ───────────────────────────────────────
  for (const r of runs) {
    const late = !!r.expectedReadyAt && r.expectedReadyAt < today
    const dueSoon = !!r.expectedReadyAt && r.expectedReadyAt >= today && r.expectedReadyAt <= urgentCutoff
    add(r.productId, {
      kind: 'run',
      text:
        (r.statusSummary ?? `${r.status.toLowerCase().replace(/_/g, ' ')} at ${r.vendor?.name ?? 'a maker not yet set'}`) +
        (r.expectedReadyAt
          ? ` — ready ${day(r.expectedReadyAt)}${r.dateConfirmed ? '' : ' (unconfirmed)'}${late ? ', passed' : ''}`
          : ' — no ready date'),
      on: r.expectedReadyAt,
      flag: late || dueSoon,
    })
  }

  // ── Dates someone has put in the calendar ─────────────────
  for (const e of events) {
    // A PAST calendar entry is still never a flag — it carries no field
    // saying whether the thing happened, so "cosmo sample yardage picked up"
    // sitting under the DELIVERY_EXPECTED type from the logistics feed cannot
    // be told apart from a delivery that never showed. A FUTURE one within
    // the window is a fact worth being red about regardless: it has not
    // happened yet, so there is nothing ambiguous about flagging it.
    const dueSoon = e.date >= today && e.date <= urgentCutoff
    add(e.productId, {
      kind: 'date',
      // Title only. The notes behind these run to several sentences and turned
      // each date into a paragraph; they are on the calendar for anyone who
      // wants them.
      text: `${day(e.date)} · ${e.title}`,
      on: e.date,
      flag: dueSoon,
    })
  }

  // ── What is waiting on a person ───────────────────────────
  for (const i of items) {
    const overdue = !!i.dueDate && i.dueDate < today
    // remindDaysBefore already existed for exactly this — "how soon before
    // dueDate does this start mattering" — and defaults to the same 3 days
    // Cleo asked for, so a todo can widen or narrow its own window without a
    // second field.
    const window = laMidnight(-(i.remindDaysBefore ?? URGENT_WINDOW_DAYS))
    const dueSoon = !!i.dueDate && i.dueDate >= today && i.dueDate <= window
    // Urgency Cleo states outright has no date to prove it, so it cannot wait
    // to be "discovered" by date math — it counts as due NOW for sorting,
    // which is what actually puts it at the top rather than the bottom of
    // the red bucket (a null date would otherwise sort last, even flagged).
    const on = i.urgent && !i.dueDate ? today : (i.dueDate ?? i.createdAt)
    add(i.entityId, {
      kind: 'waiting',
      text:
        i.title +
        (i.dueDate ? ` (due ${day(i.dueDate)}${overdue ? ', overdue' : ''})` : '') +
        (i.urgent ? ' — marked urgent' : ''),
      on,
      // An open question is not, by itself, a red flag — most products have
      // one, and if everything is red then red says nothing. Red means a
      // date has passed, a date is close, an order has not gone out, or a
      // person called it urgent outright.
      flag: overdue || dueSoon || i.urgent,
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

    // The date to sort on: the soonest thing still ahead — an order's due
    // date, a run's ready date, a todo's due date, a calendar date — never a
    // date that has already passed, since a red product is already pinned to
    // the top regardless and a past date says nothing about what is next.
    const upcoming = list
      .map((s) => s.on)
      .filter((d): d is Date => d !== null && d >= today)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null

    out.push({
      id: pid,
      name: p.name,
      headline: bits.length ? bits.join(' · ') : 'In flight.',
      strands: list,
      flag: list.some((s) => s.flag),
      onHand,
      asOf: new Date(),
      sortDate: upcoming,
    })
  }

  // Red first, unchanged — a live problem outranks a calendar date. Everything
  // else by what is coming up soonest, not alphabetically: Cleo, 17 Sept,
  // wanted the list to read as a schedule. A product with no date on file
  // (nothing waiting, nothing due) sorts last rather than by an accident of
  // its name; name is only the final tiebreak, so the order does not reshuffle
  // for no reason between two products due the same day.
  out.sort((a, b) =>
    Number(b.flag) - Number(a.flag) ||
    (a.sortDate?.getTime() ?? Infinity) - (b.sortDate?.getTime() ?? Infinity) ||
    a.name.localeCompare(b.name))
  return out
}
