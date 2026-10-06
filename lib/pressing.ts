import { laMidnight } from '@/lib/dates'

/**
 * A to-do or question that needs doing now: marked urgent, or due today or
 * earlier, or inside its own reminder window. Brandon, 6 Oct 2026: "more
 * urgent ones should float to the top and be in pink". Pure, given the day.
 */
type Due = { urgent: boolean; dueDate: Date | null; remindDaysBefore?: number | null }

export function isPressing(i: Due, tomorrow = laMidnight(-1)): boolean {
  if (i.urgent) return true
  if (!i.dueDate) return false
  const lead = Math.max(0, i.remindDaysBefore ?? 0)
  return i.dueDate.getTime() < tomorrow.getTime() + lead * 864e5
}

/** Pressing first (urgent before dated, then soonest due), the rest in their order. Stable. */
export function pressingFirst<T extends Due>(items: T[], tomorrow = laMidnight(-1)): T[] {
  const key = (i: T) => (i.urgent ? 0 : 1) * 1e15 + (i.dueDate?.getTime() ?? 9e14)
  const hot = items.filter((i) => isPressing(i, tomorrow)).sort((a, b) => key(a) - key(b))
  return [...hot, ...items.filter((i) => !isPressing(i, tomorrow))]
}
