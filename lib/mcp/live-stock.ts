import { isConfigured, shopifyGraphQL } from '@/lib/integrations/shopify'

/**
 * Live stock for the Claude connector (Brandon, 16 Oct 2026: "i would like
 * the latest stock to be included"). Shopify is the master for finished-goods
 * stock (CLAUDE.md §3); the app's onHandQty is its copy. This asks Shopify for
 * the current count of just the variants an answer is about.
 *
 * A read and nothing else: one GraphQL query, never a mutation. If Shopify is
 * not set up, errors or takes longer than LIVE_STOCK_TIMEOUT_MS, the answer
 * falls back to the app's copy and says so.
 */

export const LIVE_STOCK_TIMEOUT_MS = 8_000

export const LIVE_STOCK_QUERY = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id inventoryQuantity } } }`

/** Shopify's current inventoryQuantity for each variant id (numeric, as the app stores them). */
export type LiveStock = (shopifyVariantIds: string[]) => Promise<Map<string, number>>

export const shopifyLiveStock: LiveStock = async (ids) => {
  const out = new Map<string, number>()
  if (!ids.length) return out
  if (!isConfigured()) throw new Error('Shopify is not connected')
  const work = (async () => {
    for (let i = 0; i < ids.length; i += 250) {
      const batch = ids.slice(i, i + 250)
      const d = await shopifyGraphQL<{ nodes: Array<{ id?: string; inventoryQuantity?: number | null } | null> }>(
        LIVE_STOCK_QUERY,
        { ids: batch.map((id) => `gid://shopify/ProductVariant/${id}`) },
      )
      for (const n of d.nodes) {
        if (n?.id && typeof n.inventoryQuantity === 'number') out.set(n.id.split('/').pop()!, n.inventoryQuantity)
      }
    }
    return out
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Shopify took too long')), LIVE_STOCK_TIMEOUT_MS) })
  try { return await Promise.race([work, timeout]) } finally { clearTimeout(timer) }
}
