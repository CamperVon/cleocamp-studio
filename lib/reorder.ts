import { db } from '@/lib/db'

/**
 * How many of each product it takes to cover the coming months, worked out
 * from real sales. Brandon, 1 Oct 2026, after Mouse answered "what should we
 * order from Lorena" with a guessed rate ("~0.1/day" for a bag selling 1.7 a
 * month), "doubled to year-end" with the stock on hand never taken off, then
 * halved the Bean Bags when he said they felt high: "I just need answers based
 * on real calculations ... This is why mouse exists, period."
 *
 * The rate is retail units over the window (90 days), or since the first
 * sale when that is later, so a colour launched in July is not averaged over
 * days it was not for sale. Need = rate × months − on hand − still owed on
 * open POs, rounded up, never below zero. Wholesale and gifts are shown beside
 * it, not mixed in: store orders come in lumps (Café Forgot took 6 Bean Bags
 * in a week, and is gone). It is arithmetic; the person picks the months and
 * decides the order (CLAUDE.md §4).
 */
export type ReorderInput = {
  label: string
  onHand: number | null
  onOrder: number
  sales: Array<{ date: Date; unitsSold: number }>
  /** The first sale ever, from the whole history, not just the window. */
  firstSaleAt: Date | null
  storeAndGift: number
}
export type ReorderRow = {
  item: string; sold: number; days: number; perMonth: number; onHand: number | null; onOrder: number
  storeAndGift: number; need: Record<string, number | null>; soldOut: boolean
}

const DAY = 864e5
const MONTH = 30.44

/** One product's row. Pure. */
export function reorderRow(x: ReorderInput, today: Date, months: number[], windowDays = 90): ReorderRow {
  const windowStart = new Date(today.getTime() - windowDays * DAY)
  const start = x.firstSaleAt && x.firstSaleAt > windowStart ? x.firstSaleAt : windowStart
  const days = Math.max(1, Math.round((today.getTime() - start.getTime()) / DAY))
  const sold = x.sales.filter((s) => s.date >= start && s.date <= today).reduce((n, s) => n + s.unitsSold, 0)
  const perMonth = Math.round((sold / days) * MONTH * 10) / 10
  const need: Record<string, number | null> = {}
  for (const m of months) {
    // Unknown stock is unknown need, never "order the full amount".
    need[`${m} mo`] = x.onHand == null ? null : Math.max(0, Math.ceil((sold / days) * MONTH * m - x.onHand - x.onOrder))
  }
  return { item: x.label, sold, days, perMonth, onHand: x.onHand, onOrder: x.onOrder, storeAndGift: x.storeAndGift, need, soldOut: x.onHand === 0 }
}

/** Rows for every variant of the products whose names contain any of `names`. */
export async function reorderTable(names: string[], months: number[] = [3], windowDays = 90, today = new Date()) {
  const products = await db.product.findMany({
    where: { status: { in: ['ACTIVE', 'SAMPLING'] }, OR: names.map((n) => ({ name: { contains: n, mode: 'insensitive' as const } })), NOT: { name: { contains: '(part)' } } },
    select: { name: true, variants: { select: { id: true, size: true, onHandQty: true, colorway: { select: { customerName: true } } } } },
  })
  const ids = products.flatMap((p) => p.variants.map((v) => v.id))
  const since = new Date(today.getTime() - windowDays * DAY)
  const [firsts, sales, moves, lines] = await Promise.all([
    db.salesSnapshot.groupBy({ by: ['productVariantId'], where: { productVariantId: { in: ids }, unitsSold: { gt: 0 } }, _min: { date: true } }),
    db.salesSnapshot.findMany({ where: { productVariantId: { in: ids }, date: { gte: since } }, select: { productVariantId: true, date: true, unitsSold: true } }),
    db.inventoryEvent.findMany({ where: { productVariantId: { in: ids }, createdAt: { gte: since }, type: { in: ['WHOLESALE_SHIPPED', 'GIFTED'] } }, select: { productVariantId: true, deltaQty: true } }),
    db.purchaseOrderLine.findMany({
      where: { productVariantId: { in: ids }, purchaseOrder: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } } },
      select: { productVariantId: true, qtyOrdered: true, qtyReceived: true },
    }),
  ])
  const rows: ReorderRow[] = []
  for (const p of products) {
    for (const v of p.variants) {
      rows.push(reorderRow({
        label: [p.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / '),
        onHand: v.onHandQty == null ? null : Number(v.onHandQty),
        onOrder: lines.filter((l) => l.productVariantId === v.id).reduce((n, l) => n + Math.max(0, Number(l.qtyOrdered) - Number(l.qtyReceived)), 0),
        sales: sales.filter((s) => s.productVariantId === v.id),
        firstSaleAt: firsts.find((f) => f.productVariantId === v.id)?._min.date ?? null,
        storeAndGift: moves.filter((m) => m.productVariantId === v.id).reduce((n, m) => n + Math.abs(Number(m.deltaQty)), 0),
      }, today, months, windowDays))
    }
  }
  rows.sort((a, b) => b.perMonth - a.perMonth || a.item.localeCompare(b.item))
  const total = Object.fromEntries(months.map((m) => [`${m} mo`, rows.reduce((n, r) => n + (r.need[`${m} mo`] ?? 0), 0)]))
  return { rows, total, unknownStock: rows.filter((r) => r.onHand == null).map((r) => r.item) }
}
