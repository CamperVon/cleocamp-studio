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
  const [products, components, sales, movements, openPos] = await Promise.all([
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
    // What is already on its way. Until 16 Sept 2026 the product forecast knew
    // only what was on the shelf, so an order placed days ago did nothing to
    // calm it: Cleo Bag Black, Silver, Olive, Chocolate Suede and the Bean Bag
    // all sat under "Order by" in red while every one of them was on an open
    // Lorena PO, two of them due that Friday. The alert was telling her to do
    // the thing she had already done.
    db.purchaseOrder.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } },
      include: { lines: { include: { productVariant: { select: { productId: true } } } } },
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

  // Outstanding FINISHED GOODS per product, and when the soonest is due.
  //
  // Only two kinds of line count. A line naming a variant is finished goods by
  // definition. A described line with no component, in pieces, on an order
  // raised for a product is finished goods too — that is how "Bean Bag — Red /
  // Petite (new colourway, not yet in Shopify)" registers as coming before
  // anyone sets the variant up.
  //
  // Everything else is explicitly NOT cover. A first pass at this counted any
  // line on an order with a forProduct, which read PO 2361's 700 YARDS of fine
  // rib as 700 Cleo Tees and quietly cleared the tee's order-by alert — the
  // one product genuinely oversold, by a hundred units on Black size 1. A
  // component line is the cloth to make the thing, never the thing. "1 lot" of
  // hair ties is a yield nobody has counted yet, not one hair tie.
  const incoming = new Map<string, { qty: number; due: Date | null }>()
  for (const po of openPos) {
    for (const l of po.lines) {
      const isFinishedGoods =
        l.productVariantId !== null ||
        (l.componentId === null && l.unit.toLowerCase().startsWith('pc'))
      if (!isFinishedGoods) continue
      const pid = l.productVariant?.productId ?? po.forProductId
      if (!pid) continue
      const outstanding = Number(l.qtyOrdered) - Number(l.qtyReceived)
      if (outstanding <= 0) continue
      const cur = incoming.get(pid) ?? { qty: 0, due: null }
      cur.qty += outstanding
      if (po.expectedAt && (!cur.due || po.expectedAt < cur.due)) cur.due = po.expectedAt
      incoming.set(pid, cur)
    }
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

    const onOrder = incoming.get(p.id) ?? { qty: 0, due: null }
    const daysLeft = (onHand + onOrder.qty) / rate
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
        `Selling ${rate.toFixed(1)} a day, ${onHand} on hand` +
        (onOrder.qty
          ? ` plus ${onOrder.qty} already on order${onOrder.due ? `, due ${onOrder.due.toISOString().slice(0, 10)}` : ''}`
          : '') +
        ` — about ${(daysLeft / 7).toFixed(1)} weeks. ` +
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

/**
 * Recompute forecasts and bring the alert table into line with them.
 *
 * This used to live only in the nightly cron, so a fact that changed mid-day —
 * a PO sent, a run started, a count corrected — left the forecast and every
 * alert built on it stale until the next run. Cleo, 17 Sept 2026, looking at
 * an "Order Cleo Tee by 2026-08-25" alert hours after the order had actually
 * gone out: "it's still acting like a dumbo." The order-by alert was pinned
 * to whatever was true when it was first raised, sometimes weeks ago — the
 * SAME staleness already fixed once for the alert's own MESSAGE TEXT (16 Sept:
 * an alert refreshed its wording on every pass but never re-asked whether it
 * was still true until the cron's next run). Fixed the same way, moved earlier:
 * lib/mouse/agent.ts calls this once per chat turn that wrote something
 * forecast-relevant, so a correction is reflected before the next page load
 * instead of sitting wrong for up to a day.
 *
 * Idempotent and safe to call often: alerts dedupe on their key, a snoozed one
 * stays snoozed, and nothing here sends anything or costs money.
 */
export async function refreshForecastsAndAlerts(): Promise<{
  computed: number
  raised: number
  refreshed: number
  snoozed: number
  cleared: number
}> {
  const results = await recomputeForecasts()

  const soon = new Date(Date.now() + 7 * 864e5)
  const forecasts = await db.forecastResult.findMany({ include: { product: true, component: true } })
  let raised = 0
  let refreshed = 0
  let snoozedCount = 0
  const live = new Set<string>()

  const snoozeSince = new Date(Date.now() - 7 * 864e5)
  const snoozed = new Set(
    (await db.alert.findMany({
      where: { resolved: true, resolvedAt: { gte: snoozeSince } },
      select: { dedupeKey: true },
    })).map((a) => a.dedupeKey),
  )

  const raise = async (key: string, severity: 'WARNING' | 'URGENT', message: string) => {
    live.add(key)
    if (snoozed.has(key)) { snoozedCount++; return }
    try {
      await db.alert.create({ data: { dedupeKey: key, severity, message } })
      raised++
    } catch {
      await db.alert.updateMany({ where: { dedupeKey: key, resolved: false }, data: { severity, message } })
      refreshed++
    }
  }

  for (const f of forecasts) {
    const name = f.product?.name ?? f.component?.name ?? 'something'
    if (f.blockedReason) {
      await raise(`blocked:${f.productId ?? f.componentId}`, 'WARNING', `Can't forecast ${name} — ${f.blockedReason}`)
    } else if (f.recommendedOrderDate && f.recommendedOrderDate <= soon) {
      await raise(`order:${f.productId ?? f.componentId}`, 'URGENT',
        `Order ${name} by ${f.recommendedOrderDate.toISOString().slice(0, 10)}. ${f.note ?? ''}`.trim())
    }
  }

  const negativeVariants = await db.productVariant.findMany({
    where: { onHandQty: { lt: 0 } },
    include: { product: true, colorway: true },
  })
  for (const v of negativeVariants) {
    const label = [v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ')
    await raise(`negative:${v.id}`, 'URGENT', `${label} is at ${v.onHandQty} — oversold.`)
    live.add(`negative:${v.id}`)
  }

  const cleared = await db.alert.updateMany({
    where: {
      resolved: false,
      dedupeKey: { notIn: [...live] },
      OR: [
        { dedupeKey: { startsWith: 'blocked:' } },
        { dedupeKey: { startsWith: 'order:' } },
        { dedupeKey: { startsWith: 'negative:' } },
      ],
    },
    data: { resolved: true, resolvedAt: new Date() },
  })

  return { computed: results.length, raised, refreshed, snoozed: snoozedCount, cleared: cleared.count }
}
