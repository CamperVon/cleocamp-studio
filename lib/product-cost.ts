/**
 * What one unit costs to make (Brandon, 5 Nov 2026: "on product page, i need
 * to see the total manufacturing costs of the products"). Two parts, both
 * read from the records, never estimated:
 *
 *   - Its recipe: every bill-of-materials line for the variant, quantity per
 *     unit times the component's price on file. A sub-assembly with no price
 *     of its own is priced from its parts.
 *   - What the maker charges per unit: the unit price on the latest purchase
 *     order line for that variant (or, failing that, any variant of the same
 *     product), from an order that was sent, not a draft or a cancelled one.
 *
 * Anything without a price is named, never guessed (CLAUDE.md §3: unknown is
 * safe, wrong is not), and the total then reads "at least". A maker billing in
 * another currency is shown beside the dollar figure rather than added to it.
 * Pure, except `productCosts`, which reads.
 */
import { lineFits, type LineScope } from '@/lib/bom'
import { db } from '@/lib/db'

export type CostLine = {
  name: string
  category: string
  qty: number
  unit: string
  unitCents: number | null
  /** qty × unit price, or null when either is unknown. */
  cents: number | null
}

export type MakerCharge = { cents: number; currency: string; vendor: string; poNumber: string }

export type VariantCost = {
  label: string
  lines: CostLine[]
  /** Sum of the recipe lines that have a price. */
  recipeCents: number
  /** Recipe lines with no price, or with the quantity still unknown. */
  unpriced: string[]
  maker: MakerCharge | null
  /** Recipe plus the maker's charge in dollars; a floor when anything is missing. */
  totalCents: number
  complete: boolean
}

type Comp = { id: string; name: string; category: string; unitOfMeasure: string; unitCostCents: number | null; parts?: Array<{ qtyPerUnit: number; unitCostCents: number | null }> }
type Line = LineScope & { qtyPerUnit: number; component: Comp }

/** A component's price per its unit: its own, else its parts' when every part has one. Pure. */
export function componentPrice(c: Comp): number | null {
  if (c.unitCostCents != null) return c.unitCostCents
  if (!c.parts?.length || c.parts.some((p) => p.unitCostCents == null)) return null
  return Math.round(c.parts.reduce((n, p) => n + p.qtyPerUnit * (p.unitCostCents as number), 0))
}

/** One variant's cost to make. Pure. */
export function variantCost(
  label: string,
  bom: Line[],
  variant: { size: string | null; colorway?: { customerName: string } | null },
  maker: MakerCharge | null,
): VariantCost {
  const lines: CostLine[] = []
  const unpriced: string[] = []
  for (const b of bom) {
    if (!lineFits(b, variant)) continue
    const unitCents = componentPrice(b.component)
    const known = b.qtyPerUnit > 0 && unitCents != null
    if (!known) unpriced.push(b.qtyPerUnit > 0 ? `${b.component.name} (no price)` : `${b.component.name} (quantity unknown)`)
    lines.push({
      name: b.component.name, category: b.component.category, qty: b.qtyPerUnit, unit: b.component.unitOfMeasure,
      unitCents, cents: known ? Math.round(b.qtyPerUnit * (unitCents as number)) : null,
    })
  }
  const recipeCents = lines.reduce((n, l) => n + (l.cents ?? 0), 0)
  const makerUsd = maker && maker.currency === 'USD' ? maker.cents : 0
  return {
    label, lines, recipeCents, unpriced, maker,
    totalCents: recipeCents + makerUsd,
    complete: !unpriced.length && !!maker && maker.currency === 'USD' && lines.length > 0,
  }
}

/** The figure for a product: one number, or a range when variants differ. Pure. */
export function costSummary(costs: VariantCost[]): { lowCents: number; highCents: number; complete: boolean; foreignMaker: MakerCharge | null } | null {
  if (!costs.length) return null
  const totals = costs.map((c) => c.totalCents)
  return {
    lowCents: Math.min(...totals),
    highCents: Math.max(...totals),
    complete: costs.every((c) => c.complete),
    foreignMaker: costs.find((c) => c.maker && c.maker.currency !== 'USD')?.maker ?? null,
  }
}

/** Every product's cost per variant, read in two queries. */
export async function productCosts(): Promise<Map<string, VariantCost[]>> {
  const [products, poLines] = await Promise.all([
    db.product.findMany({
      select: {
        id: true,
        variants: { select: { id: true, size: true, colorway: { select: { customerName: true } } } },
        bomLines: {
          select: {
            qtyPerUnit: true, size: true, colorway: true,
            component: {
              select: {
                id: true, name: true, category: true, unitOfMeasure: true, unitCostCents: true,
                subAssembly: { select: { qtyPerUnit: true, component: { select: { unitCostCents: true } } } },
              },
            },
          },
        },
      },
    }),
    db.purchaseOrderLine.findMany({
      where: { productVariantId: { not: null }, unitCostCents: { not: null }, purchaseOrder: { status: { in: ['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'] } } },
      select: {
        productVariantId: true, unitCostCents: true,
        productVariant: { select: { productId: true } },
        purchaseOrder: { select: { poNumber: true, currency: true, orderedAt: true, createdAt: true, vendor: { select: { name: true } } } },
      },
    }),
  ])
  // Newest order first, so the first line found for a variant is its latest price.
  const newest = [...poLines].sort((a, b) =>
    (b.purchaseOrder.orderedAt ?? b.purchaseOrder.createdAt).getTime() - (a.purchaseOrder.orderedAt ?? a.purchaseOrder.createdAt).getTime())
  const charge = (l: (typeof poLines)[number]): MakerCharge => ({
    cents: l.unitCostCents as number, currency: l.purchaseOrder.currency ?? 'USD', vendor: l.purchaseOrder.vendor?.name ?? 'the maker', poNumber: l.purchaseOrder.poNumber,
  })
  const out = new Map<string, VariantCost[]>()
  for (const p of products) {
    const bom: Line[] = p.bomLines.map((b) => ({
      size: b.size, colorway: b.colorway, qtyPerUnit: Number(b.qtyPerUnit),
      component: {
        id: b.component.id, name: b.component.name, category: String(b.component.category), unitOfMeasure: b.component.unitOfMeasure,
        unitCostCents: b.component.unitCostCents,
        parts: b.component.subAssembly.map((s) => ({ qtyPerUnit: Number(s.qtyPerUnit), unitCostCents: s.component.unitCostCents })),
      },
    }))
    const ofProduct = newest.find((l) => l.productVariant?.productId === p.id)
    const costs = p.variants.map((v) => {
      const own = newest.find((l) => l.productVariantId === v.id) ?? ofProduct
      const label = [v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'One variant'
      return variantCost(label, bom, v, own ? charge(own) : null)
    })
    out.set(p.id, costs)
  }
  return out
}
