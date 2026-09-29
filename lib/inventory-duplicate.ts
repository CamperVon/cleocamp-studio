/**
 * Has this exact change already been logged?
 *
 * 25 Sept 2026: Brandon told Mouse 8 Black Petite bean bags had been picked up
 * from Lorena. Mouse logged +8 and pushed it to Shopify. He asked "Meaning you
 * updated Shopify?", and Mouse, distrusting its own record, logged the same +8
 * again, a minute later: 16 in the app and in Shopify, against 8 on the shelf.
 * Its instructions already said to check before redoing anything. That did not
 * hold, so this is a check in code.
 *
 * A change (not a count) to the same item, place, type and quantity within a
 * day is treated as the same event unless the call says otherwise. A COUNTED
 * event states an absolute number, so repeating one is harmless and is never
 * blocked. Pure, so it can be tested without a database.
 */
export const DUPLICATE_WINDOW_MS = 24 * 3600e3

export type EventKey = {
  componentId?: string | null
  productVariantId?: string | null
  locationId?: string | null
  atVendorId?: string | null
  type: string
  deltaQty?: number | null
}

export function isRepeatOf(next: EventKey, prior: EventKey & { createdAt: Date }, now = new Date()): boolean {
  if (next.type === 'COUNTED' || next.type === 'CORRECTION') return false
  if (next.deltaQty === undefined || next.deltaQty === null) return false
  if (now.getTime() - prior.createdAt.getTime() > DUPLICATE_WINDOW_MS) return false
  return (
    (next.componentId ?? null) === (prior.componentId ?? null) &&
    (next.productVariantId ?? null) === (prior.productVariantId ?? null) &&
    // No place given means the tool will default one (the studio), so a
    // call that names none matches the earlier event wherever it landed.
    (!next.locationId && !next.atVendorId
      ? true
      : (next.locationId ?? null) === (prior.locationId ?? null) && (next.atVendorId ?? null) === (prior.atVendorId ?? null)) &&
    next.type === prior.type &&
    Number(next.deltaQty) === Number(prior.deltaQty)
  )
}

/**
 * A second receipt of the same item within a week, whatever the amount, is
 * worth a question before it goes in. On 18 Sept 2026 a Lorena pickup was
 * logged that never happened; the real one on 22 Sept went in on top of it,
 * twice, and Shopify showed 9 Black Cleo Bags against 1 in the studio. The
 * exact-repeat check above only looks back a day and needs the same number.
 * This does not block for good: a person saying "yes, that's a second lot" is
 * enough. Receipts already reversed are left out by the caller. Pure.
 */
export const SAME_DELIVERY_WINDOW_MS = 7 * 864e5

export function looksLikeSameDelivery(next: EventKey, prior: EventKey & { createdAt: Date }, now = new Date()): boolean {
  if (next.type !== 'RECEIVED' || prior.type !== 'RECEIVED') return false
  if (!(Number(next.deltaQty) > 0) || !(Number(prior.deltaQty) > 0)) return false
  if (now.getTime() - prior.createdAt.getTime() > SAME_DELIVERY_WINDOW_MS) return false
  return (next.componentId ?? null) === (prior.componentId ?? null) &&
    (next.productVariantId ?? null) === (prior.productVariantId ?? null)
}
