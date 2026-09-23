/**
 * Which "Order X" calendar entries should exist, given tonight's forecast —
 * worked out apart from the database so it can be tested.
 *
 * Until 23 Sept 2026 the nightly job only ever ADDED these: each night it
 * wrote an "Order Cleo Tee" entry at that night's recommended date and left
 * every earlier night's entry where it was. 116 had built up, several per
 * product, each at a different date, most of them wrong. Coming up showed
 * "Order Cleo Bag — Black" today and tomorrow while the forecast itself said
 * 14 December. Brandon had spotted every entry reading the same date.
 *
 * Now it reconciles: one entry per forecast, at its current date. Only
 * Mouse's own ORDER_BY entries from today onward are touched — past ones are
 * history nobody reads here, and synced or manual entries are never touched.
 * A forecast whose date has already passed gets no entry at all; the "Order
 * X by <date>" alert is where an overdue one belongs, not a date in the past.
 */

export type WantedEntry = { title: string; date: Date; productId: string | null; notes: string | null }
export type ExistingEntry = { id: string; title: string; date: Date }

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

export function planOrderByCalendar(
  wanted: WantedEntry[],
  existing: ExistingEntry[],
  today: Date,
): { remove: string[]; create: WantedEntry[] } {
  const want = new Map<string, WantedEntry>()
  for (const w of wanted) {
    if (w.date < today) continue
    want.set(w.title, w)
  }

  const remove: string[] = []
  const kept = new Set<string>()
  for (const e of existing) {
    if (e.date < today) continue
    const w = want.get(e.title)
    const key = `${e.title}|${dayKey(e.date)}`
    if (w && dayKey(w.date) === dayKey(e.date) && !kept.has(key)) {
      kept.add(key)
    } else {
      remove.push(e.id)
    }
  }

  const create = [...want.values()].filter((w) => !kept.has(`${w.title}|${dayKey(w.date)}`))
  return { remove, create }
}
