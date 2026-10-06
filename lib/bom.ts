/**
 * Which of a product's variants a recipe line is for. A line can be limited
 * to one size (the size 2 number sticker), one colour (the black silk lining
 * in the Black Bean Bag only, 6 Oct 2026), or both; with neither it is for
 * every variant. Pure.
 */
export type LineScope = { size?: string | null; colorway?: string | null }
type VariantLike = { size: string | null; colorway?: { customerName: string } | null }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function lineFits(line: LineScope, v: VariantLike): boolean {
  if (line.size && !(v.size && same(v.size, line.size))) return false
  if (line.colorway && !(v.colorway && same(v.colorway.customerName, line.colorway))) return false
  return true
}

/** " (Black only)", " (size 2 only)", " (Black, size 2 only)", or "" for every variant. Pure. */
export function lineScopeLabel(line: LineScope): string {
  const parts = [line.colorway, line.size ? `size ${line.size}` : null].filter(Boolean)
  return parts.length ? ` (${parts.join(', ')} only)` : ''
}

/** The product's own spelling of a colour named loosely, or null if it has none by that name. Pure. */
export function matchColorway(name: string, colorways: Array<{ customerName: string }>): string | null {
  return colorways.find((c) => same(c.customerName, name))?.customerName ?? null
}
