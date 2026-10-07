/**
 * What to send Shopify, and what to write here, when someone tells Mouse
 * about finished-goods stock. Pure, so the arithmetic can be tested.
 *
 * Shopify's count is the live one: it moves with every web sale, minute by
 * minute, while ours only catches up at the next sync. So the change is
 * applied on top of Shopify's number, never ours (Brandon, 3 Oct 2026: "Mouse
 * should pull the Shopify number before adding another number because
 * Shopify will be more real time accurate"). Until then the app sent its own
 * cached count as the starting point, and Shopify refused the write whenever
 * a sale had landed since the last sync: 14 stock logs lost that way between
 * 14 and 30 Sept 2026.
 *
 *   - "20 received": Shopify gets +20 on whatever it has now.
 *   - "we counted 12": Shopify gets whatever change makes it 12.
 *
 * `drift` is how far Shopify has moved from our ledger (sales, fulfilments,
 * edits made in Shopify). It is recorded first as its own sync entry, exactly
 * as a Shopify sync would, so the ledger still adds up to the count.
 */
export function planVariantPush(a: {
  /** Shopify's available count at the studio, read just now. */
  live: number
  /** The sum of our own ledger for this variant. */
  ledger: number
  countedQty?: number
  deltaQty?: number
}): { drift: number; push: number; next: number } {
  const push = a.countedQty !== undefined ? a.countedQty - a.live : a.deltaQty!
  return { drift: a.live - a.ledger, push, next: a.live + push }
}

/** Shopify refused because its count moved between our read and our write. */
export function isStaleCountRefusal(error: string): boolean {
  return /changeFromQuantity/i.test(error)
}

/**
 * The count to keep locally when Shopify is not in the picture (no Shopify
 * link, or writing off). Our cache is the only baseline: unknown plus a
 * change stays unknown, because a change says nothing about what was there.
 *
 * The one exception is the first delivery of something that has never had a
 * stock entry and is not on Shopify. Nothing can have been there before it
 * was made, so the ledger is the whole story. Until 7 Oct 2026 this stayed
 * unknown too: the 5to7 Skirt was logged in at 2 a size on 25 Sept and read
 * UNKNOWN on hand for eleven days, through two gifts and six wholesale
 * shipments, until someone counted it. Pure.
 */
export function localNextCount(a: {
  cached: number | null; countedQty?: number; deltaQty: number
  type: string; onShopify: boolean; earlierEvents: number
}): number | null {
  if (a.countedQty !== undefined) return a.countedQty
  if (a.cached !== null) return a.cached + a.deltaQty
  if (a.type === 'RECEIVED' && !a.onShopify && a.earlierEvents === 0 && a.deltaQty > 0) return a.deltaQty
  return null
}
