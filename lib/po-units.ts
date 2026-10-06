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
 * Read from the line's own unit when it states a size ("500/roll"), else
 * from the component's purchase unit and units per purchase unit, else 1:
 * the same unit, or one nothing says how to convert (as before). Pure.
 */
type Comp = { unitOfMeasure: string; purchaseUnit?: string | null; unitsPerPurchaseUnit?: unknown } | null | undefined

const forms = (s: string) => {
  const w = s.trim().toLowerCase()
  return new Set([w, w.replace(/s$/, ''), w.replace(/es$/, '')])
}
const sameUnit = (a: string, b: string) => [...forms(a)].some((x) => forms(b).has(x))

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
  const per = Number(comp.unitsPerPurchaseUnit)
  if (comp.purchaseUnit && sameUnit(base, comp.purchaseUnit) && per > 0) return per
  return 1
}
