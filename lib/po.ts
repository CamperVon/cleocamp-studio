import type { Component, ProductVariant, Product, Colorway } from '@/generated/prisma/client'

/** An unpriced line is unknown, never free. Round per line to whole cents. */
export function poLineAmount(qty: number, unitCostCents: number | null): number | null {
  return unitCostCents === null ? null : Math.round(qty * unitCostCents)
}

export function poAmounts(lines: Array<{ qtyOrdered: unknown; unitCostCents: number | null }>) {
  const amounts = lines.map(l => poLineAmount(Number(l.qtyOrdered), l.unitCostCents))
  return { knownCents: amounts.reduce<number>((sum, n) => sum + (n ?? 0), 0), incomplete: amounts.some(n => n === null) }
}

/**
 * A purchase order line names either a component or a finished-goods variant
 * — see the comment on PurchaseOrderLine in schema.prisma. Every place that
 * summarises a line (the finances list, in-flight rows, the home page, the
 * nightly digest) needs to handle both, so it lives here once rather than
 * six times slightly differently.
 */
export function poLineLabel(l: {
  component: Component | null
  productVariant: (ProductVariant & { product: Product; colorway: Colorway | null }) | null
  description?: string | null
}): string {
  if (l.component) return l.component.name
  const v = l.productVariant
  // Not every line points at a catalogue row, and it should not have to. A
  // purchase order is often how a new thing first exists — a colour nobody
  // has dyed, a size nobody has cut. Those lines carry their own text.
  if (!v) return l.description || 'unknown item'
  return [v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ')
}
