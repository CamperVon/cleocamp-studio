import { db } from '@/lib/db'
import { shopifyGraphQL } from '@/lib/integrations/shopify'

/**
 * Anything new on Shopify comes into the app by itself, every night
 * (Brandon, 8 Oct 2026: "mouse should always know when new products /
 * variants are added or in shopify"). That day the Black and White Boy Belts
 * went live on Shopify as their own listings and the app never heard of
 * them, so when Cleo asked Mouse to move one of each to the stylist
 * inventory, Mouse had nothing to move and asked a question instead.
 *
 * The nightly sync already saw the listings and only counted them. Now, for
 * each listing that is for sale on Shopify and not in the app:
 *  - a new colour or size of a listing already here joins its product;
 *  - a listing whose sister colour (custom.sister_colours, set on Shopify) is
 *    here comes in as its own product on the sister's style, the way the
 *    Cleo Bag colours and the Boy Belts are (settled 8 Oct 2026);
 *  - anything else comes in as a new product, unless the app has something
 *    with a similar name. That one is never guessed: a question is raised,
 *    once, naming the lookalikes.
 * Drafts wait until they go on sale; archived listings are retired. It reads
 * Shopify and never writes to it (lib/shopify-import.ts).
 */

export type Listing = { shopifyProductId: string; title: string; status: string }

/** The listings to bring in: for sale on Shopify, one each. Pure. */
export function listingsToCatchUp(listings: Listing[]): Listing[] {
  const seen = new Set<string>()
  return listings.filter((l) => l.status === 'ACTIVE' && !seen.has(l.shopifyProductId) && seen.add(l.shopifyProductId))
}

/** The marker that ties a question to its listing, so it is raised once. Pure. */
export const listingMarker = (shopifyProductId: string) => `Shopify product ${shopifyProductId}`

/** The question for a listing that looks like something already here. Pure. */
export function lookalikeQuestion(l: Listing, lookalikes: string[]): { title: string; detail: string } {
  return {
    title: `On Shopify, not in the app: "${l.title}". Is it ${lookalikes.map((n) => `"${n}"`).join(' or ')}, or a new product?`,
    detail:
      `"${l.title}" is for sale on Shopify (${listingMarker(l.shopifyProductId)}) and the app does not have it, so it ` +
      `cannot be counted, invoiced or pulled. The app has something with a similar name: ${lookalikes.join(', ')}. ` +
      'Say which it is, or that it is new, and Mouse brings it in (import_from_shopify). If it is another colour ' +
      'of one of them, it comes in as its own product on the same style.',
  }
}

export type CatchUpResult = { brought: string[]; asked: string[]; failed: string[] }

/** The app products holding any of these Shopify variants, with their style. */
async function sistersInApp(shopifyProductId: string): Promise<Array<{ id: string; name: string; styleNumber: string | null }>> {
  const d = await shopifyGraphQL<{ product: { metafield: { references: { nodes: Array<{ variants?: { nodes: Array<{ id: string }> } }> } | null } | null } | null }>(
    `query($id: ID!) { product(id: $id) { metafield(namespace: "custom", key: "sister_colours") {
      references(first: 20) { nodes { ... on Product { variants(first: 100) { nodes { id } } } } } } } }`,
    { id: `gid://shopify/Product/${shopifyProductId}` },
  )
  const ids = (d.product?.metafield?.references?.nodes ?? []).flatMap((n) => n.variants?.nodes.map((v) => v.id.split('/').pop()!) ?? [])
  if (!ids.length) return []
  const vs = await db.productVariant.findMany({
    where: { shopifyVariantId: { in: ids } },
    select: { product: { select: { id: true, name: true, style: { select: { number: true } } } } },
  })
  const by = new Map(vs.map((v) => [v.product.id, { id: v.product.id, name: v.product.name, styleNumber: v.product.style?.number ?? null }]))
  return [...by.values()]
}

export async function catchUpShopify(listings: Listing[], opts: { dryRun?: boolean } = {}): Promise<CatchUpResult> {
  const out: CatchUpResult = { brought: [], asked: [], failed: [] }
  const { fetchShopifyProduct, importShopifyProduct } = await import('@/lib/shopify-import')
  const { linkStyle } = await import('@/lib/style-admin')
  for (const l of listingsToCatchUp(listings)) {
    try {
      const p = await fetchShopifyProduct(l.shopifyProductId)
      if (!p || p.status !== 'ACTIVE') continue
      const sisters = await sistersInApp(l.shopifyProductId).catch(() => [])
      if (opts.dryRun) { out.brought.push(`${l.title} (dry run${sisters.length ? `, sister of ${sisters[0].name}` : ''})`); continue }
      let r = await importShopifyProduct(p)
      // A sister colour already here settles the lookalike: its own product, same style.
      if (!r.imported && r.lookalikes && sisters.length) r = await importShopifyProduct(p, { asNew: true })
      if (!r.imported) {
        if (!r.lookalikes) { out.failed.push(`${l.title}: ${r.reason}`); continue }
        const open = await db.actionItem.findFirst({ where: { resolved: false, detail: { contains: listingMarker(l.shopifyProductId) } }, select: { id: true } })
        if (!open) {
          const q = lookalikeQuestion(l, r.lookalikes.map((x) => x.name))
          await db.actionItem.create({ data: { kind: 'QUESTION', source: 'SYSTEM', title: q.title, detail: q.detail } })
        }
        out.asked.push(l.title)
        continue
      }
      const style = sisters.find((s) => s.styleNumber)?.styleNumber
      if (style) {
        const product = await db.product.findUnique({ where: { id: r.productId }, select: { styleId: true } })
        if (!product?.styleId) await linkStyle(r.productId, style)
      }
      if (r.created.length || r.linked.length) out.brought.push(`${r.product}${style ? ` (style ${style})` : ''}: ${[...r.created, ...r.linked].length} variant${[...r.created, ...r.linked].length === 1 ? '' : 's'}`)
    } catch (e) {
      out.failed.push(`${l.title}: ${(e as Error).message}`)
    }
  }
  return out
}

/**
 * What came in from Shopify since a moment, by product, for the Daily Cheese
 * and anyone asking. Variants are only ever made with a Shopify link by the
 * import, so a linked variant made since then is one that arrived.
 */
export async function arrivedFromShopify(since: Date): Promise<string[]> {
  const vs = await db.productVariant.findMany({
    where: { createdAt: { gte: since }, shopifyVariantId: { not: null } },
    select: { size: true, colorway: { select: { customerName: true } }, product: { select: { name: true, createdAt: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const by = new Map<string, { isNew: boolean; parts: string[] }>()
  for (const v of vs) {
    const e = by.get(v.product.name) ?? { isNew: v.product.createdAt >= since, parts: [] }
    const part = [v.colorway?.customerName, v.size].filter(Boolean).join(' ')
    if (part) e.parts.push(part)
    by.set(v.product.name, e)
  }
  return arrivalLines([...by.entries()].map(([name, e]) => ({ name, ...e })))
}

/** "Boy Belt - Black is new in the app (Extra Small, Small, Medium, Large)." Pure. */
export function arrivalLines(products: Array<{ name: string; isNew: boolean; parts: string[] }>): string[] {
  return products.map((p) => {
    const list = p.parts.length ? ` (${p.parts.join(', ')})` : ''
    return p.isNew ? `${p.name} is new in the app${list}.` : `${p.name} has new sizes or colours in the app${list}.`
  })
}
