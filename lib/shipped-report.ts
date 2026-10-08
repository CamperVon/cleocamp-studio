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
