import type { Component, ProductVariant, Product, Colorway } from '@/generated/prisma/client'

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
