/**
 * Where a new purchase order is delivered, when the call didn't say.
 *
 * It used to copy the address of the newest order to the same vendor, on the
 * reasoning that "terms and delivery address do not change per order". For a
 * trim supplier they do: goods go to whoever is making that run. On 24 Sept
 * 2026 PO 2386 (14L and 16L buttons, for Cleo's house) replaced PO 2384 and
 * came out addressed to Lorena in South Gate, because PO 2385 (18L buttons,
 * for Lorena) had been drafted fifteen minutes earlier. The reply said only
 * "carried over: delivery address", so nobody saw which one.
 *
 * So: an order that replaces another takes that order's address. Otherwise an
 * address is carried over only when the vendor's recent orders all went to the
 * same place. When they didn't, it stays blank and Mouse asks. A wrong ship-to
 * on a PO sends real goods to the wrong door; a blank one costs a question.
 */
export type PriorOrder = { poNumber: string; deliverTo: string | null }

export function chooseDeliverTo(opts: {
  given?: string | null
  replaces?: PriorOrder | null
  recent: PriorOrder[]
}): { value: string | null; from: string | null; conflict: string[] } {
  if (opts.given) return { value: opts.given, from: null, conflict: [] }
  if (opts.replaces?.deliverTo) {
    return { value: opts.replaces.deliverTo, from: `PO ${opts.replaces.poNumber}, which this replaces`, conflict: [] }
  }
  const withAddress = opts.recent.filter((o) => o.deliverTo)
  const distinct = [...new Set(withAddress.map((o) => o.deliverTo!.trim()))]
  if (distinct.length === 1) {
    return { value: distinct[0], from: `PO ${withAddress[0].poNumber}`, conflict: [] }
  }
  return { value: null, from: null, conflict: distinct }
}
