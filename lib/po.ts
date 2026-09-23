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
 * Total quantity, grouped by unit rather than blindly summed. Brandon, 11
 * Sept: "I need total units at the bottom of these POs as well. Not just
 * total price." Every real PO on file so far orders in one unit throughout
 * — all "pcs", or all "yards" — but nothing enforces that, and 50 yards of
 * fabric plus 200 buttons is not "250" of anything. One line per unit
 * reads correctly either way: the common case prints exactly like a single
 * total ("2,230 pcs"), and a mixed order still says something true instead
 * of something wrong.
 */
export function poUnitTotals(lines: Array<{ qtyOrdered: unknown; unit: string }>): Array<{ unit: string; qty: number }> {
  const byUnit = new Map<string, number>()
  for (const l of lines) byUnit.set(l.unit, (byUnit.get(l.unit) ?? 0) + Number(l.qtyOrdered))
  return [...byUnit.entries()].map(([unit, qty]) => ({ unit, qty }))
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

/**
 * A PO price in the order's own currency. Every PO printed "$" until 23 Sept
 * 2026, whatever it was priced in — belts from Italy went out at "$35" when
 * the price was €35.
 */
export function poMoney(cents: number, currency: string = 'USD'): string {
  const symbol = currency === 'EUR' ? '\u20ac' : currency === 'GBP' ? '\u00a3' : currency === 'USD' ? '$' : `${currency} `
  return symbol + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
