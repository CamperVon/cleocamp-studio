import { db } from '@/lib/db'
import { observedLeadDays, worthAsking, type LeadTimeCandidate } from '@/lib/lead-time-core'

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
 * It SETS the number itself (Brandon, 25 Oct 2026: "in the future, don't
 * ask, just make the call and change as we need to"). Until then it only
 * raised a question naming the figure, on the reasoning that one delivery is
 * one data point; the team was answering yes to every one. Each change is
 * written down as a note on the record (what it was, what it is, which
 * delivery), so a one-off can be put back by saying so. The maths and
 * wording are in lib/lead-time-core.ts, tested apart from this.
 *
 * Shared with lib/production-lead-learning.ts, which asks the same
 * question of a production run's own startedAt/receivedAt against a
 * product's productionLeadTimeDays.
 */

/**
 * `sourceLabel` doubles as the dedupe key: a delivery already learned from
 * (a note naming it, or an old question about it) is not applied twice. A
 * different delivery on the same record is a new data point and is.
 */
async function alreadyLearned(entityType: LeadTimeCandidate['entityType'], entityId: string, sourceLabel: string) {
  const [note, question] = await Promise.all([
    db.note.findFirst({ where: { entityType, entityId, content: { contains: `from ${sourceLabel}` } }, select: { id: true } }),
    db.actionItem.findFirst({ where: { entityType, entityId, kind: 'QUESTION', detail: { contains: sourceLabel } }, select: { id: true } }),
  ])
  return !!(note || question)
}

/** Sets each candidate's lead time from what was observed, when it differs enough, and notes the change. */
export async function learnLeadTimes(
  candidates: LeadTimeCandidate[],
  observedDays: number,
  sourceLabel: string,
  startLabel: string,
  start: Date,
  end: Date,
): Promise<string[]> {
  const changed: string[] = []
  for (const c of candidates) {
    if (!worthAsking(c.recorded, observedDays)) continue
    if (await alreadyLearned(c.entityType, c.entityId, sourceLabel)) continue
    if (c.entityType === 'COMPONENT') await db.component.update({ where: { id: c.entityId }, data: { leadTimeDays: observedDays } })
    else if (c.entityType === 'VENDOR') await db.vendor.update({ where: { id: c.entityId }, data: { leadTimeDays: observedDays } })
    else await db.product.update({ where: { id: c.entityId }, data: { productionLeadTimeDays: observedDays } })
    const was = c.recorded === null ? 'none on file' : `${c.recorded} days`
    await db.note.create({
      data: {
        entityType: c.entityType, entityId: c.entityId, source: 'SYSTEM',
        content: `Lead time set to ${observedDays} days (was ${was}) from ${sourceLabel}: ${startLabel} ${start.toISOString().slice(0, 10)} to delivery ${end.toISOString().slice(0, 10)}. Set automatically; say so if this one was unusual.`,
      },
    })
    changed.push(`${c.name}: lead time set to ${observedDays} days (was ${was}), from ${sourceLabel}`)
  }
  return changed
}

/**
 * Called once, right when a PO's receivedAt is first set — see
 * update_purchase_order in lib/mouse/tools.ts. Safe to call on any PO;
 * quietly does nothing when there isn't enough on the order to learn from.
 * Returns what it changed, so the same turn can mention it.
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
  return learnLeadTimes(candidates, observedDays, `PO ${po.poNumber}`, startLabel, start, po.receivedAt!)
}
