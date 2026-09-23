/**
 * The maths and the wording behind lead-time learning, apart from the
 * database — so it can be tested without touching the real one. See
 * lib/lead-time-learning.ts, which wraps this with the actual reads and
 * writes.
 */

const DAY = 864e5

/**
 * How far apart counts as worth asking about, scaled to the number itself.
 * Two days either way on a three-day local pickup is noise; two days on a
 * five-week fabric order is not, but neither is anything under this floor
 * worth a question over.
 */
export function driftThreshold(recordedDays: number): number {
  return Math.max(3, Math.round(recordedDays * 0.25))
}

/**
 * The observed gap in whole days between when the clock actually started
 * (a deposit, if there was one, otherwise the order itself) and delivery.
 * Null when there isn't enough on the order to learn from, or the dates
 * don't make sense as a real gap (same day, or backwards — most likely a
 * date entered out of order rather than a same-day delivery).
 */
export function observedLeadDays(
  orderedAt: Date | null,
  depositPaidAt: Date | null,
  receivedAt: Date | null,
): number | null {
  if (!receivedAt) return null
  const start = depositPaidAt ?? orderedAt
  if (!start) return null
  const days = Math.round((receivedAt.getTime() - start.getTime()) / DAY)
  return days > 0 ? days : null
}

export type LeadTimeCandidate = { entityType: 'VENDOR' | 'COMPONENT'; entityId: string; name: string; recorded: number | null }

/** Whether this candidate is worth asking about, given what was observed. */
export function worthAsking(recorded: number | null, observedDays: number): boolean {
  return recorded === null || Math.abs(observedDays - recorded) >= driftThreshold(recorded)
}

export function questionFor(
  c: LeadTimeCandidate,
  observedDays: number,
  poNumber: string,
  startLabel: 'the deposit' | 'the order',
  startDate: Date,
  receivedAt: Date,
): { title: string; detail: string } {
  const title =
    c.recorded === null
      ? `Set ${c.name}'s lead time from PO ${poNumber}?`
      : `${c.name}'s lead time may have changed`
  const detail =
    c.recorded === null
      ? `No lead time on file for ${c.name}. PO ${poNumber} took ${observedDays} days from ` +
        `${startLabel} (${startDate.toISOString().slice(0, 10)}) to delivery (${receivedAt.toISOString().slice(0, 10)}). ` +
        `Set it to ${observedDays} days?`
      : `Recorded at ${c.recorded} days. PO ${poNumber} took ${observedDays} days from ${startLabel} to ` +
        `delivery instead. Update to ${observedDays}, or was this one unusual?`
  return { title, detail }
}
