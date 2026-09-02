import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'

/**
 * The forecast.
 *
 * Demand is DTC sales plus wholesale and gifts. Stylist pulls are excluded —
 * they leave the studio but nobody bought them, and counting them as sales
 * over-orders.
 *
 * Recent weeks are weighted far more heavily than old ones. Cleo Camp went from
 * $8k in April to $68k in August; a flat eight-week average would badly
 * under-forecast a curve like that.
 *
 * Components are consumed at PRODUCTION time, not at sale time. So sales drive
 * future production need, which drives component demand. Deducting components
 * straight from sales would count them twice.
 */

const HORIZON_DAYS = 84
const DAY = 864e5

export type Blocked = { reason: string }

/** Weighted mean units per day. Last two weeks count triple, weeks three and four double. */
function ratePerDay(rows: Array<{ date: Date; unitsSold: number }>): number {
  const now = Date.now()
  let num = 0
  let den = 0
  for (let d = 0; d < 56; d++) {
    const dayStart = now - (d + 1) * DAY
    const dayEnd = now - d * DAY
    const units = rows
      .filter((r) => r.date.getTime() >= dayStart && r.date.getTime() < dayEnd)
      .reduce((n, r) => n + r.unitsSold, 0)
    const w = d < 14 ? 3 : d < 28 ? 2 : 1
    num += units * w
    den += w
  }
  return den === 0 ? 0 : num / den
}

export async function recomputeForecasts() {
  const since = laMidnight(56)
  const [products, components, sales, movements] = await Promise.all([
    db.product.findMany({
      where: { status: { in: ['ACTIVE', 'SAMPLING'] } },
      include: {
        variants: true,
        bomLines: { include: { component: { include: { vendor: true } } } },
      },
    }),
    db.component.findMany({ where: { active: true }, include: { vendor: true } }),
    db.salesSnapshot.findMany({ where: { date: { gte: since } } }),
    db.inventoryEvent.findMany({
      where: { createdAt: { gte: since }, type: { in: ['WHOLESALE_SHIPPED', 'GIFTED'] } },
    }),
  ])

  const salesByVariant = new Map<string, Array<{ date: Date; unitsSold: number }>>()
  for (const s of sales) {
    const list = salesByVariant.get(s.productVariantId) ?? []
    list.push({ date: s.date, unitsSold: s.unitsSold })
    salesByVariant.set(s.productVariantId, list)
  }
  // Wholesale and gifts are demand too.
  for (const m of movements) {
    if (!m.productVariantId) continue
    const list = salesByVariant.get(m.productVariantId) ?? []
    list.push({ date: m.createdAt, unitsSold: Math.abs(Number(m.deltaQty)) })
    salesByVariant.set(m.productVariantId, list)
  }

  await db.forecastResult.deleteMany({})
  const results: Array<{ kind: 'product' | 'component'; id: string; name: string; note: string; blocked?: string; stockout?: Date; orderBy?: Date }> = []

  // ── Products ──────────────────────────────────────────────
  const productDemand = new Map<string, number>() // units/day needing production
  for (const p of products) {
    const rate = p.variants.reduce((n, v) => n + ratePerDay(salesByVariant.get(v.id) ?? []), 0)
    const onHand = p.variants.reduce(
      (n, v) => (v.onHandQty === null ? n : n + Number(v.onHandQty)), 0)
    const anyUnknown = p.variants.some((v) => v.onHandQty === null)

    if (rate <= 0) continue
    productDemand.set(p.id, rate)

    if (anyUnknown) {
      results.push({ kind: 'product', id: p.id, name: p.name,
        note: `Selling about ${rate.toFixed(1)} a day.`,
        blocked: 'Some variants have no count, so days of cover cannot be worked out.' })
      continue
    }

    const daysLeft = onHand / rate
    const stockout = new Date(Date.now() + daysLeft * DAY)

    // Chain: components must arrive, then be made, then dyed.
    const compLead = Math.max(0, ...p.bomLines.map((b) => b.component.leadTimeDays ?? 0))
    const missingLead = p.bomLines.some((b) => b.component.leadTimeDays === null)
    const dye = p.bomLines.length ? 0 : 0
    if (p.productionLeadTimeDays === null) {
      results.push({ kind: 'product', id: p.id, name: p.name, stockout,
        note: `About ${(daysLeft / 7).toFixed(1)} weeks of cover at ${rate.toFixed(1)} a day.`,
        blocked: 'No production lead time, so there is no date by which to order.' })
      continue
    }
    const totalLead = compLead + p.productionLeadTimeDays + dye
    const orderBy = new Date(stockout.getTime() - totalLead * DAY)
    results.push({
      kind: 'product', id: p.id, name: p.name, stockout, orderBy,
      note:
        `Selling ${rate.toFixed(1)} a day, ${onHand} on hand — about ${(daysLeft / 7).toFixed(1)} weeks. ` +
        `Components take ${compLead}d and production ${p.productionLeadTimeDays}d, so start by then.` +
        (missingLead ? ' One component has no lead time, so this may be optimistic.' : ''),
    })
  }

  // ── Components ────────────────────────────────────────────
  for (const c of components) {
    const usedIn = products.filter((p) => p.bomLines.some((b) => b.componentId === c.id))
    let perDay = 0
    for (const p of usedIn) {
      const line = p.bomLines.find((b) => b.componentId === c.id)!
      const qty = Number(line.qtyPerUnit)
      if (qty === 0) continue
      perDay += (productDemand.get(p.id) ?? 0) * qty
    }
    if (perDay <= 0) continue

    const available = Number(c.onHandQty) + Number(c.incomingQty)
    if (!c.stockedInStudio) {
      // Bought per run, so there is no stock level to burn down. What matters is
      // whether what is on order covers the horizon.
      const needed = perDay * HORIZON_DAYS
      results.push({
        kind: 'component', id: c.id, name: c.name,
        note:
          `A ${HORIZON_DAYS}-day run needs about ${Math.ceil(needed)} ${c.unitOfMeasure}. ` +
          `${Number(c.incomingQty)} on order.` +
          (Number(c.incomingQty) < needed ? ' That is short.' : ' Covered.'),
      })
      continue
    }

    const daysLeft = available / perDay
    const stockout = new Date(Date.now() + daysLeft * DAY)
    if (c.leadTimeDays === null) {
      results.push({ kind: 'component', id: c.id, name: c.name, stockout,
        note: `Using about ${perDay.toFixed(1)} ${c.unitOfMeasure} a day, ${available} available.`,
        blocked: `No lead time for ${c.vendor?.name ?? 'this supplier'}, so there is no date by which to order.` })
      continue
    }
    const orderBy = new Date(stockout.getTime() - c.leadTimeDays * DAY)
    results.push({
      kind: 'component', id: c.id, name: c.name, stockout, orderBy,
      note: `Using ${perDay.toFixed(1)} ${c.unitOfMeasure} a day, ${available} available — about ${(daysLeft / 7).toFixed(1)} weeks. Lead time ${c.leadTimeDays}d.`,
    })
  }

  for (const r of results) {
    await db.forecastResult.create({
      data: {
        productId: r.kind === 'product' ? r.id : null,
        componentId: r.kind === 'component' ? r.id : null,
        projectedStockoutDate: r.stockout ?? null,
        recommendedOrderDate: r.orderBy ?? null,
        note: r.note,
        blockedReason: r.blocked ?? null,
      },
    })
  }
  return results
}
