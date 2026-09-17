import { db } from '@/lib/db'

/**
 * Cleo, 17 Sept 2026, describing why Studio Mouse was built in the first
 * place: "when we send a PO for bags or teas or whatever else, Mouse will
 * know what all of the components are, and what all the lead times are, and
 * will tell us... set the deadlines in order to make the delivery date, or
 * the date for the manufacturer to start... when you click on the product,
 * it will say, order the snaps, order the tags, etc. And whenever it is
 * talking about ordering a component that is shared with another product,
 * remind us we also need that for the other product."
 *
 * The math already existed in lib/forecast.ts — per-component lead time,
 * a stockout date, an order-by date worked backward through it — but only as
 * a CONTINUOUS sales-driven forecast: it answers "when will we run out,"
 * never "what does THIS finished-goods order need before the manufacturer
 * can start." This runs once, at the moment a cut-and-sew PO is actually
 * sent, and turns that product's BOM into a dated checklist. It does not
 * touch or replace recomputeForecasts() — that keeps running nightly (and
 * after any chat write, via refreshForecastsAndAlerts) exactly as before;
 * this is a second, separate trigger, not a rewrite of the first.
 *
 * PACKAGING is left out on purpose — CLAUDE.md/the component model says it
 * is "consumed per SHIPMENT," so it has nothing to do with a manufacturer
 * starting to cut. SUBASSEMBLY components are listed as their own line
 * (whoever supplies the finished handle, say) rather than recursed into
 * their own sub-BOM — a real limitation, not a silent one: a subassembly
 * with its own multi-component BOM would need a second pass to reach the
 * parts under it.
 */

const DAY = 864e5

export type KickoffLine = {
  componentId: string
  componentName: string
  category: string
  qtyNeeded: number
  unit: string
  covered: number
  shortfall: number
  vendorName: string | null
  leadTimeDays: number | null
  orderBy: Date | null
  sharedWith: string[]
  created: boolean
  todoId: string | null
  skippedReason: string | null
}

export type KickoffResult = {
  productId: string
  productName: string
  qtyOrdered: number
  manufacturerStartBy: Date | null
  lines: KickoffLine[]
}

/**
 * Called once a cut-and-sew PO for a product has actually gone out. Walks
 * that product's BOM, works out what still needs ordering to hit the
 * manufacturer's start date, and files a dated TODO for each shortfall —
 * entityType PRODUCT so it lands on that product's row in Products in
 * production, the same place `create_todo`'s entityType/entityId reaches.
 */
export async function planComponentKickoff(
  productId: string,
  qtyOrdered: number,
  po: { poNumber: string; expectedAt: Date | null },
): Promise<KickoffResult | null> {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: {
      bomLines: { include: { component: { include: { vendor: true } } } },
    },
  })
  if (!product || qtyOrdered <= 0) return null

  const lines = product.bomLines.filter((b) => b.component.category !== 'PACKAGING')
  if (!lines.length) return { productId, productName: product.name, qtyOrdered, manufacturerStartBy: null, lines: [] }

  // The date the manufacturer needs to START, not the date the goods are
  // due back — that is what a component's own lead time counts backward
  // from. Both inputs are real facts already on the PO/product, never
  // guessed: no PO ready date or no production lead time just means no
  // deadline can be computed, not a made-up one.
  const manufacturerStartBy =
    po.expectedAt && product.productionLeadTimeDays != null
      ? new Date(po.expectedAt.getTime() - product.productionLeadTimeDays * DAY)
      : null

  // Which OTHER active products use each of these components, for the
  // "you'll also need this for X" reminder. One query for every component
  // on this BOM rather than one per line.
  const componentIds = lines.map((l) => l.componentId)
  const sharedBomLines = await db.bomLine.findMany({
    where: { componentId: { in: componentIds }, parentProductId: { not: null } },
    include: { parentProduct: { select: { id: true, name: true, status: true } } },
  })
  const sharedWithByComponent = new Map<string, string[]>()
  for (const b of sharedBomLines) {
    if (!b.parentProduct || b.parentProductId === productId) continue
    if (b.parentProduct.status === 'SUNSETTED') continue
    const list = sharedWithByComponent.get(b.componentId) ?? []
    list.push(b.parentProduct.name)
    sharedWithByComponent.set(b.componentId, list)
  }

  const out: KickoffLine[] = []
  for (const bom of lines) {
    const c = bom.component
    const qtyNeeded = Number(bom.qtyPerUnit) * qtyOrdered
    const covered = Number(c.onHandQty) + Number(c.incomingQty)
    const shortfall = Math.max(0, qtyNeeded - covered)
    const sharedWith = [...new Set(sharedWithByComponent.get(c.id) ?? [])]

    if (shortfall <= 0) {
      out.push({
        componentId: c.id, componentName: c.name, category: c.category,
        qtyNeeded, unit: c.unitOfMeasure, covered, shortfall: 0,
        vendorName: c.vendor?.name ?? null, leadTimeDays: c.leadTimeDays,
        orderBy: null, sharedWith, created: false, todoId: null,
        skippedReason: 'already covered by stock and what is on order',
      })
      continue
    }

    const orderBy =
      manufacturerStartBy && c.leadTimeDays != null
        ? new Date(manufacturerStartBy.getTime() - c.leadTimeDays * DAY)
        : null

    const title = `Order ${c.name} for ${product.name} (PO ${po.poNumber})`
    const existing = await db.actionItem.findFirst({
      where: { kind: 'TODO', resolved: false, entityType: 'PRODUCT', entityId: productId, title },
      select: { id: true },
    })
    if (existing) {
      out.push({
        componentId: c.id, componentName: c.name, category: c.category,
        qtyNeeded, unit: c.unitOfMeasure, covered, shortfall,
        vendorName: c.vendor?.name ?? null, leadTimeDays: c.leadTimeDays,
        orderBy, sharedWith, created: false, todoId: existing.id,
        skippedReason: 'already on the list from an earlier pass',
      })
      continue
    }

    const detailParts = [
      `Need ${shortfall.toLocaleString()} ${c.unitOfMeasure} (${qtyNeeded.toLocaleString()} for ${qtyOrdered.toLocaleString()} units, ${covered.toLocaleString()} already covered).`,
      c.vendor?.name ? `From ${c.vendor.name}.` : 'No vendor set for this component yet.',
      c.leadTimeDays == null ? 'Lead time unknown, so this deadline may be optimistic.' : null,
      manufacturerStartBy == null
        ? 'No ready date or production lead time on this PO/product, so no firm deadline could be worked out — order it as soon as reasonable.'
        : null,
      sharedWith.length
        ? `Also used in: ${sharedWith.join(', ')} — worth checking whether those need topping up in the same order.`
        : null,
    ].filter(Boolean)

    const created = await db.actionItem.create({
      data: {
        kind: 'TODO',
        title,
        detail: detailParts.join(' '),
        dueDate: orderBy,
        entityType: 'PRODUCT',
        entityId: productId,
        source: 'SYSTEM',
      },
      select: { id: true },
    })

    out.push({
      componentId: c.id, componentName: c.name, category: c.category,
      qtyNeeded, unit: c.unitOfMeasure, covered, shortfall,
      vendorName: c.vendor?.name ?? null, leadTimeDays: c.leadTimeDays,
      orderBy, sharedWith, created: true, todoId: created.id, skippedReason: null,
    })
  }

  return { productId, productName: product.name, qtyOrdered, manufacturerStartBy, lines: out }
}
