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
}): string {
  if (l.component) return l.component.name
  const v = l.productVariant
  if (!v) return 'unknown item'
  return [v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ')
}
