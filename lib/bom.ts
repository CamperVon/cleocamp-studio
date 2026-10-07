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

/**
 * A component that goes into no product: it never shows on Products and the
 * forecast cannot count it. Packaging is meant to sit on no product. Brandon,
 * 7 Oct 2026, after 16 leathers and silks sat like this unnoticed: "make sure
 * this never happens again." Pure.
 */
export function onNoProduct(c: { category: string; _count: { usedIn: number } }): boolean {
  return c.category !== 'PACKAGING' && c._count.usedIn === 0
}

/** A recipe change refused part-way: the transaction rolls back and the tool says why. */
export class BomRefusal extends Error {}

type ExistingLine = { id: string; qtyPerUnit: unknown; size: string | null; colorway: string | null }

/**
 * Which existing recipe line a change means, or that it is a new one. A line
 * is one component for one scope (a size, a colour, both, or every variant).
 * Pure.
 *
 *   - Scope left out: the one line there is (as before lines had scope), or a
 *     new all-variants line. Several scoped lines: say which.
 *   - Scope given: the line with exactly that scope. Failing that, an
 *     all-variants line with no amount yet (a placeholder) becomes this one.
 *     An all-variants line WITH an amount would count those variants twice
 *     beside a scoped one, so it is refused, never doubled.
 */
export function pickBomLine(lines: ExistingLine[], scoped: boolean, size: string | null, colorway: string | null): { line: ExistingLine | null } | { error: string } {
  const amount = (l: ExistingLine) => Number(l.qtyPerUnit)
  const all = lines.filter((l) => !l.size && !l.colorway)
  if (!scoped) {
    if (lines.length <= 1) return { line: lines[0] ?? null }
    return { error: `it has ${lines.length} lines by size or colour (${lines.map((l) => lineScopeLabel(l).trim() || 'every variant').join(', ')}). Say which with size or colorway.` }
  }
  const exact = lines.find((l) => (l.size ?? null) === size && (l.colorway ?? null) === colorway)
  if (exact) return { line: exact }
  if (!size && !colorway) {
    if (lines.length) return { error: 'it already has lines by size or colour; an all-variants line beside them would count those twice. Remove them first if that is what is meant.' }
    return { line: null }
  }
  if (all.length) {
    const a = all[0]
    if (amount(a) === 0 && lines.length === 1) return { line: a }
    return { error: `it already has an all-variants line${amount(a) ? ` of ${amount(a)}` : ''}; a ${lineScopeLabel({ size, colorway }).trim()} line beside it would count those variants twice. Set that line by size or colour instead, or remove it first.` }
  }
  return { line: null }
}
