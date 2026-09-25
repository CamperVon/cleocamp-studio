import { db } from '@/lib/db'
import { observedLeadDays, worthAsking, questionFor, type LeadTimeCandidate } from '@/lib/lead-time-core'

/**
 * Learning an actual lead time from a real delivery.
 *
 * Brandon, 23 Sept 2026: "I want mouse to learn from PO being sent to
 * delivery the actual lead times and or if they change." Every purchase
 * order already carries the two dates this needs — orderedAt (or
 * depositPaidAt, when a deposit is what the clock actually runs from —
 * update_purchase_order's own comment: "Lead times that run 'from PO' often
 * really run from payment") and receivedAt, set the moment goods land. The
 * observed gap between them is real evidence a recorded lead time either
 * never had, or has since drifted from.
 *
 * NEVER WRITES THE NUMBER ITSELF. One delivery is one data point — a
 * vendor's one-off delay or a lucky early truck is not "the lead time
 * changed," and CLAUDE.md's rule holds here same as anywhere else: a wrong
 * number written to a plan is worse than an unanswered question. This
 * raises a QUESTION naming the exact figure and lets a person say yes. The
 * maths and wording are in lib/lead-time-core.ts, tested apart from this.
 *
 * Shared with lib/production-lead-learning.ts, which asks the same
 * question of a production run's own startedAt/receivedAt against a
 * product's productionLeadTimeDays.
 */

/**
 * `sourceLabel` doubles as the dedupe key — checked against the DETAIL, not
 * the title, because a candidate with a recorded number already on file
 * gets a title of just "X's lead time may have changed" with the source
 * named only in the body. The same source should never ask about the same
 * entity twice; a different source drifting on it is a second, independent
 * data point and gets its own question.
 */
async function alreadyAsked(entityType: LeadTimeCandidate['entityType'], entityId: string, sourceLabel: string) {
  return db.actionItem.findFirst({
    where: { entityType, entityId, kind: 'QUESTION', detail: { contains: sourceLabel } },
    select: { id: true },
  })
}

/** Runs every candidate through worthAsking/dedupe and raises what's left. */
export async function raiseLeadTimeQuestions(
  candidates: LeadTimeCandidate[],
  observedDays: number,
  sourceLabel: string,
  startLabel: string,
  start: Date,
  end: Date,
): Promise<string[]> {
  const raised: string[] = []
  for (const c of candidates) {
    if (!worthAsking(c.recorded, observedDays)) continue
    if (await alreadyAsked(c.entityType, c.entityId, sourceLabel)) continue
    const { title, detail } = questionFor(c, observedDays, sourceLabel, startLabel, start, end)
    await db.actionItem.create({
      data: { kind: 'QUESTION', entityType: c.entityType, entityId: c.entityId, title, detail, source: 'SYSTEM' },
    })
    raised.push(title)
  }
  return raised
}

/**
 * Called once, right when a PO's receivedAt is first set — see
 * update_purchase_order in lib/mouse/tools.ts. Safe to call on any PO;
 * quietly does nothing when there isn't enough on the order to learn from.
 * Returns what it raised, if anything, so the same turn can mention it
 * rather than it only surfacing later on the Items page.
 */
export async function checkLeadTimeDrift(poId: string): Promise<string[]> {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    include: { vendor: true, lines: { include: { component: true } } },
  })
  if (!po) return []

  const observedDays = observedLeadDays(po.orderedAt, po.depositPaidAt, po.receivedAt)
  if (observedDays === null) return []

  // A line naming a component speaks to that component's own lead time —
  // the same field forecast.ts reads for it, and different components from
  // the same vendor can genuinely differ (RichLine's fine rib ships same-day;
  // their lurex is a 21-day production run). A line with no component —
  // finished goods, a cut-and-sew order — speaks to the VENDOR's own
  // turnaround instead: Vendor.leadTimeDays is documented as exactly this,
  // "on a manufacturer this is cut-and-sew time."
  //
  // Only lines that actually arrived are evidence. On 24 Sept 2026 PO 2375
  // was partly received (the Size and Cosmo x Cleo labels) and this asked
  // whether Main label's lead time was now 8 days, when not one Main label
  // had come; Jane was still waiting on them the next day. A fully received
  // order counts every line; a partial one only lines with a quantity in.
  const arrived = po.status === 'RECEIVED'
    ? po.lines
    : po.lines.filter((l) => Number(l.qtyReceived) > 0)
  const candidates: LeadTimeCandidate[] = []
  const seen = new Set<string>()
  for (const l of arrived) {
    if (!l.component || seen.has(l.component.id)) continue
    seen.add(l.component.id)
    candidates.push({ entityType: 'COMPONENT', entityId: l.component.id, name: l.component.name, recorded: l.component.leadTimeDays })
  }
  if (arrived.some((l) => l.componentId === null)) {
    candidates.push({ entityType: 'VENDOR', entityId: po.vendor.id, name: po.vendor.name, recorded: po.vendor.leadTimeDays })
  }

  const start = po.depositPaidAt ?? po.orderedAt!
  const startLabel = po.depositPaidAt ? 'the deposit' : 'the order'
  return raiseLeadTimeQuestions(candidates, observedDays, `PO ${po.poNumber}`, startLabel, start, po.receivedAt!)
}
