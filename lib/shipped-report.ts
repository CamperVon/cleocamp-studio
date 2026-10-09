import type { ShippedOrder } from '@/lib/integrations/shopify'

/**
 * What went out on labels made between two Los Angeles days, item by item
 * (8 Oct 2026). Jane asked how many Black Cleo Tees, by size, the orders she
 * had bought labels for on 7 Oct needed, and Mouse could not say: sales
 * analytics has order dates, not label dates. A Shopify label is a
 * fulfilment, dated the moment it is made; fetchShippedOrders already reads
 * them (the packing count uses it). This adds them up. Pure.
 */
export type ShippedLine = { item: string; variant: string | null; quantity: number; orders: string[] }

export function tallyShipped(
  packages: ShippedOrder[],
  opts: { from: string; to: string; item?: string | null; variant?: string | null },
): { orders: number; packages: number; lines: ShippedLine[] } {
  const want = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const item = want(opts.item)
  const variant = want(opts.variant)
  const inRange = packages.filter((p) => p.shippedOn >= opts.from && p.shippedOn <= opts.to)
  const byKey = new Map<string, ShippedLine>()
  const orders = new Set<string>()
  for (const p of inRange) {
    for (const i of p.items) {
      // "Cleo Tee" means that product, not "Cleo Tee - Splish": a whole-title
      // match when given, so one product is never counted as another.
      if (item && want(i.title) !== item) continue
      if (variant && !want(i.variant).split(/\s*\/\s*/).concat(want(i.variant)).includes(variant)) continue
      orders.add(p.name)
      const key = `${i.title}\u0000${i.variant ?? ''}`
      const line = byKey.get(key) ?? { item: i.title, variant: i.variant, quantity: 0, orders: [] }
      line.quantity += i.quantity
      line.orders.push(i.quantity > 1 ? `${p.name} ×${i.quantity}` : p.name)
      byKey.set(key, line)
    }
  }
  const lines = [...byKey.values()].sort((a, b) =>
    a.item.localeCompare(b.item) || (a.variant ?? '').localeCompare(b.variant ?? '', undefined, { numeric: true }))
  return { orders: orders.size, packages: inRange.length, lines }
}

/**
 * The longest range one look-up may cover. Each look-up reads every Shopify
 * order updated since its first day, so a long range is a long scan; 31 days
 * answers any label-day question, and a longer one is asked in parts.
 */
export const MAX_LABEL_DAYS = 31

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Why a from/to range cannot be looked up as asked, or null. Checked before anything reaches Shopify. Pure. */
export function labelRangeProblem(from: string, to: string): string | null {
  // A real day round-trips; "2026-02-30" parses as 2 March and does not.
  const real = (d: string) => DAY_RE.test(d) && !Number.isNaN(dayMs(d)) && dayStr(dayMs(d)) === d
  if (!real(from) || !real(to) || to < from) {
    return 'Give from (and to) as YYYY-MM-DD, to on or after from.'
  }
  const days = Math.round((dayMs(to) - dayMs(from)) / 864e5) + 1
  if (days <= MAX_LABEL_DAYS) return null
  const parts: string[] = []
  for (let start = dayMs(from); start <= dayMs(to); start += MAX_LABEL_DAYS * 864e5) {
    parts.push(`${dayStr(start)} to ${dayStr(Math.min(start + (MAX_LABEL_DAYS - 1) * 864e5, dayMs(to)))}`)
  }
  return `That is ${days} days; one look-up covers at most ${MAX_LABEL_DAYS}. Look it up in ${parts.length} parts and add them up: ${parts.join('; ')}.`
}
