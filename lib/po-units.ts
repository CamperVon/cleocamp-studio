/**
 * How many of a component's own counting unit one unit of a PO line holds.
 *
 * 6 Oct 2026: PO 2388 ordered stickers by the roll ("6 roll (500/roll)",
 * "2 roll (Number 1, 1000/roll)") while stock counts single stickers. Every
 * figure that read the line took 6 rolls as 6 stickers: the forecast said 6
 * on order and short, and when Jane delivered 3,000 silver and 6,000 number
 * stickers the receipt was refused as more than the order owed. Mouse could
 * not log a delivery that plainly happened.
 *
 * 13 Oct 2026: PO 2407 ordered thermal labels as "2 packs of 2,000" with the
 * component's purchase unit "pack of 2,000", and incoming read 2 labels, not
 * 4,000: neither the "of 2,000" wording nor a purchase unit longer than one
 * word was understood.
 *
 * Read from the line's own unit when it states a size ("500/roll", "packs
 * of 2,000"), else from the component's purchase unit and units per
 * purchase unit, else 1: the same unit, or one nothing says how to convert
 * (as before). Pure.
 */
type Comp = { unitOfMeasure: string; purchaseUnit?: string | null; unitsPerPurchaseUnit?: unknown } | null | undefined

const forms = (s: string) => {
  const w = s.trim().toLowerCase()
  return new Set([w, w.replace(/s$/, ''), w.replace(/es$/, '')])
}
export const sameUnit = (a: string, b: string) => [...forms(a)].some((x) => forms(b).has(x))

export function unitsPerLineUnit(lineUnit: string | null | undefined, comp: Comp): number {
  if (!comp || !lineUnit) return 1
  const u = lineUnit.trim().toLowerCase()
  const base = u.split(/[\s(,]/)[0]
  if (!base || sameUnit(base, comp.unitOfMeasure)) return 1
  const stated = /([\d][\d,]*(?:\.\d+)?)\s*\/\s*([a-z]+)/.exec(u)
  if (stated && sameUnit(stated[2], base)) {
    const n = Number(stated[1].replace(/,/g, ''))
    if (n > 0) return n
  }
  // "packs of 2,000" (13 Oct 2026, PO 2407): the size written after "of".
  // A unit after the number must be the one the stock counts in, so "case
  // of 12 boxes" for something counted in pieces is not read as 12.
  const of = /^[a-z]+\s+of\s+([\d][\d,]*(?:\.\d+)?)(?:\s+([a-z]+))?/.exec(u)
  if (of && (!of[2] || sameUnit(of[2], comp.unitOfMeasure))) {
    const n = Number(of[1].replace(/,/g, ''))
    if (n > 0) return n
  }
  // The purchase unit by its first word, so "packs" matches "pack of 2,000".
  const per = Number(comp.unitsPerPurchaseUnit)
  const bought = comp.purchaseUnit?.trim().toLowerCase().split(/[\s(,]/)[0]
  if (bought && sameUnit(base, bought) && per > 0) return per
  return 1
}

/**
 * The price per purchase unit, when a component is bought in a different unit
 * from the one it is counted in: the 5to7 shell is counted in yards (Staples'
 * yardage per skirt) and bought by the metre at $12.24, stored as $11.19 a
 * yard (Brandon, 12 Oct 2026: "metre price, and US beside it"). Null when
 * there is no other unit or no conversion. Pure.
 */
export function purchaseUnitPrice(c: { unitCostCents: number | null; unitOfMeasure: string; purchaseUnit?: string | null; unitsPerPurchaseUnit?: unknown }): { cents: number; unit: string } | null {
  const per = Number(c.unitsPerPurchaseUnit)
  if (c.unitCostCents === null || !c.purchaseUnit || !(per > 0) || sameUnit(c.purchaseUnit, c.unitOfMeasure)) return null
  return { cents: Math.round(c.unitCostCents * per), unit: c.purchaseUnit }
}

/**
 * Why a price in cents cannot be stored, or null. Prices are whole cents, and
 * a fraction was silently rounded: PO 2397's stickers at 0.409 cents each
 * saved as $0, and PO 2407's labels at 1.883 cents as 1 cent, so both totals
 * were wrong (13 Oct 2026). A wrong price is worse than none, so it is
 * refused, with what to do instead. Pure.
 */
export function centsProblem(cents: unknown): string | null {
  if (cents === undefined || cents === null) return null
  const n = Number(cents)
  if (!Number.isFinite(n) || n < 0) return `"${String(cents)}" is not a price in cents.`
  if (Number.isInteger(n)) return null
  return `${n} cents is a fraction of a cent, and prices are kept in whole cents, so it would be saved as ` +
    `${Math.round(n)} and every total built on it would be wrong. Price it per pack instead: on a ` +
    `purchase order, make the line's unit the pack ("pack of 1,000") and give the price of one pack ` +
    `(the stock still counts single items). For a component's cost on file, leave the price out and ` +
    `put the pack price in its notes.`
}
