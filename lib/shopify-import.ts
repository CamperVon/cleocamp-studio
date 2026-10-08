import { db } from '@/lib/db'
import { shopifyGraphQL } from '@/lib/integrations/shopify'
import { shopifyText } from '@/lib/integrations/shopify-sync'

/**
 * Bringing a product in from Shopify. Brandon, 30 Sept 2026, after Cleo
 * spent twenty minutes trying to invoice a Sardine that Mouse could not see:
 * "she added sardine and hair tie to products in shopify yesterday. how do we
 * tell mouse. in the future, can we tell mouse and it can search shopify."
 *
 * The nightly sync only refreshes variants the app already knows; anything
 * new in Shopify was counted as "seen" and left out, so a product listed on
 * Monday could not be invoiced, counted or put on the line sheet until
 * someone built it by hand. Now Mouse can search Shopify (findInShopify) and,
 * once a person says yes, bring the product in (importShopifyProduct).
 *
 * Shopify stays the master (CLAUDE.md §3): the import reads, never writes to
 * Shopify, and a variant's count arrives the way the sync writes one, as a
 * COUNTED event beside the number in the same transaction, so onHandQty still
 * adds up from the ledger.
 */

export type ShopifyVariantData = {
  id: string
  title: string
  price: string
  inventoryQuantity: number | null
  selectedOptions: Array<{ name: string; value: string }>
  image?: { url: string } | null
  inventoryItem: { id: string }
}
export type ShopifyProductData = {
  id: string
  title: string
  handle: string
  status: string
  description: string | null
  featuredImage?: { url: string } | null
  variants: { nodes: ShopifyVariantData[] }
}

const PRODUCT_FIELDS = `id title handle status description featuredImage { url }
  variants(first: 100) { nodes { id title price inventoryQuantity selectedOptions { name value } image { url } inventoryItem { id } } }`

const numericId = (gid: string) => gid.split('/').pop()!

/**
 * A variant's colour and size from its Shopify options. "Size" is the size;
 * the first other option (Color, Handle Color, Style…) is the colour, the
 * way the app already names these; "Title / Default Title" is neither. Pure.
 */
export function readOptions(options: Array<{ name: string; value: string }>): { colour: string | null; size: string | null } {
  const real = options.filter((o) => !(o.name === 'Title' && o.value === 'Default Title'))
  const size = real.find((o) => /size/i.test(o.name))?.value ?? null
  const colour = real.find((o) => !/size/i.test(o.name))?.value ?? null
  return { colour, size }
}

/** "https://cleocamp.com/products/sardine?variant=…" → "sardine". Pure. */
export function handleFromUrl(text: string): string | null {
  return /\/products\/([a-z0-9][a-z0-9-]*)/i.exec(text)?.[1]?.toLowerCase() ?? null
}

/** App products whose name is close enough to ask about before making another. Pure. */
export function lookalikes<P extends { name: string }>(title: string, products: P[]): P[] {
  const norm = (s: string) => s.toLowerCase().replace(/\(part\)|[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const t = norm(title)
  return products.filter((p) => {
    const n = norm(p.name)
    return !!n && (n === t || n.includes(t) || t.includes(n))
  })
}

/** Search Shopify by name, handle or product link. Read-only. */
export async function findInShopify(query: string) {
  const handle = handleFromUrl(query)
  const q = handle ? `handle:${handle}` : `title:*${query.replace(/["\\]/g, '').trim()}*`
  const d = await shopifyGraphQL<{ products: { nodes: ShopifyProductData[] } }>(
    `query($q: String!) { products(first: 10, query: $q) { nodes { ${PRODUCT_FIELDS} } } }`, { q },
  )
  const ids = d.products.nodes.flatMap((p) => p.variants.nodes.map((v) => numericId(v.id)))
  const known = new Map((await db.productVariant.findMany({
    where: { shopifyVariantId: { in: ids } }, select: { shopifyVariantId: true, product: { select: { id: true, name: true } } },
  })).map((v) => [v.shopifyVariantId!, v.product]))
  return d.products.nodes.map((p) => {
    const inApp = p.variants.nodes.map((v) => known.get(numericId(v.id))).filter(Boolean)
    return {
      shopifyProductId: numericId(p.id), title: p.title, status: p.status,
      variants: p.variants.nodes.map((v) => ({
        name: v.title === 'Default Title' ? 'one variant' : v.title, price: `$${v.price}`, shopifyCount: v.inventoryQuantity,
        inApp: known.has(numericId(v.id)),
      })),
      inApp: inApp.length === p.variants.nodes.length ? 'yes' : inApp.length ? `partly, as ${inApp[0]!.name}` : 'no',
    }
  })
}

export async function fetchShopifyProduct(shopifyProductId: string): Promise<ShopifyProductData | null> {
  const d = await shopifyGraphQL<{ product: ShopifyProductData | null }>(
    `query($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`, { id: `gid://shopify/Product/${numericId(shopifyProductId)}` },
  )
  return d.product
}

export type ImportResult =
  | { imported: true; productId: string; product: string; created: string[]; linked: string[]; alreadyIn: string[]; counts: string[] }
  | { imported: false; reason: string; lookalikes?: Array<{ id: string; name: string; status: string }> }

/**
 * Bring one Shopify product's variants into the app. Idempotent: variants
 * already here are left alone, so it also picks up a colour added to a
 * product that is already in.
 *
 * Where it goes: the app product that already holds some of this listing's
 * variants; else intoProductId, when a person has said which one (Cleo's
 * "Hair Tie", made by hand before it was on Shopify); else a new product.
 * When an app product has a similar name and nobody has said, it writes
 * nothing and hands back the lookalikes to ask about, rather than make a
 * second "Hair Tie".
 */
export async function importShopifyProduct(
  p: ShopifyProductData,
  opts: { intoProductId?: string; asNew?: boolean; actorId?: string | null } = {},
): Promise<ImportResult> {
  const shopIds = p.variants.nodes.map((v) => numericId(v.id))
  const already = await db.productVariant.findMany({ where: { shopifyVariantId: { in: shopIds } }, select: { shopifyVariantId: true, productId: true } })
  const holder = already[0]?.productId ?? null
  if (holder && opts.intoProductId && opts.intoProductId !== holder) {
    return { imported: false, reason: `Some of ${p.title} is already in the app under another product (${holder}). It goes there, not into ${opts.intoProductId}.` }
  }

  let productId = holder ?? opts.intoProductId ?? null
  if (productId && !(await db.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
    return { imported: false, reason: `No product ${productId}. Look it up again.` }
  }
  if (!productId && !opts.asNew) {
    const all = await db.product.findMany({ select: { id: true, name: true, status: true } })
    const close = lookalikes(p.title, all)
    if (close.length) {
      return {
        imported: false, lookalikes: close,
        reason: `The app already has something like "${p.title}". Ask whether this Shopify listing is one of these (bring it in with intoProductId) or a new product (asNew: true). Do not guess.`,
      }
    }
  }

  const prices = p.variants.nodes.map((v) => Math.round(parseFloat(v.price) * 100)).filter((c) => Number.isFinite(c))
  if (!productId) {
    const created = await db.product.create({
      data: {
        name: p.title.trim(),
        status: p.status === 'DRAFT' || p.status === 'ARCHIVED' ? 'DEVELOPMENT' : 'ACTIVE',
        retailPriceCents: prices.length ? Math.min(...prices) : null,
        shopifyProductId: numericId(p.id),
        shopifyDescription: shopifyText(p.description),
      },
      select: { id: true },
    })
    productId = created.id
  } else {
    await db.product.update({
      where: { id: productId },
      data: {
        shopifyDescription: shopifyText(p.description) ?? undefined,
        // Brought onto Shopify means it is being sold, whatever stage the app had it at.
        ...(p.status === 'ACTIVE' ? { status: 'ACTIVE' } : {}),
      },
    })
  }

  const product = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, name: true, colorways: { select: { id: true, customerName: true } }, variants: { select: { id: true, colorwayId: true, size: true, shopifyVariantId: true } } },
  })
  const studio = await db.location.findFirst({ where: { name: 'Studio' }, select: { id: true } })
  const colourIds = new Map(product.colorways.map((c) => [c.customerName.toLowerCase(), c.id]))
  const unlinked = product.variants.filter((v) => !v.shopifyVariantId)
  const created: string[] = [], linked: string[] = [], alreadyIn: string[] = [], counts: string[] = []

  for (const v of p.variants.nodes) {
    const sid = numericId(v.id)
    const { colour, size } = readOptions(v.selectedOptions)
    const label = [product.name, colour, size].filter(Boolean).join(' / ')
    if (already.some((a) => a.shopifyVariantId === sid)) { alreadyIn.push(label); continue }

    let colorwayId: string | null = null
    if (colour) {
      colorwayId = colourIds.get(colour.toLowerCase()) ?? null
      if (!colorwayId) {
        colorwayId = (await db.colorway.create({ data: { productId: product.id, customerName: colour }, select: { id: true } })).id
        colourIds.set(colour.toLowerCase(), colorwayId)
      }
    }
    // A variant the app made before the listing existed: same colour and
    // size, or the only one of a one-variant product.
    const match = unlinked.find((u) => u.colorwayId === colorwayId && (u.size ?? null) === (size ?? null))
      ?? (p.variants.nodes.length === 1 && unlinked.length === 1 && product.variants.length === 1 ? unlinked[0] : undefined)
    if (match) unlinked.splice(unlinked.indexOf(match), 1)

    const fields = {
      shopifyVariantId: sid,
      shopifyInventoryItemId: v.inventoryItem.id,
      retailPriceCents: Math.round(parseFloat(v.price) * 100),
      imageUrl: v.image?.url ?? p.featuredImage?.url ?? null,
      ...(studio ? { locationId: studio.id } : {}),
      // Shopify's colour and size, also on a variant being linked.
      colorwayId, size,
    }
    const variantId = match
      ? (await db.productVariant.update({ where: { id: match.id }, data: fields, select: { id: true } })).id
      : (await db.productVariant.create({ data: { productId: product.id, ...fields }, select: { id: true } })).id
    ;(match ? linked : created).push(label)

    // Shopify's count, written the way the sync writes one. Not tracked in
    // Shopify means unknown: no event, no number.
    if (v.inventoryQuantity != null) {
      const sum = await db.inventoryEvent.aggregate({ where: { productVariantId: variantId }, _sum: { deltaQty: true } })
      const drift = v.inventoryQuantity - Number(sum._sum.deltaQty ?? 0)
      await db.$transaction([
        ...(drift !== 0 ? [db.inventoryEvent.create({
          data: {
            productVariantId: variantId, type: 'COUNTED', source: 'SYSTEM', createdById: opts.actorId ?? null,
            countedQty: String(v.inventoryQuantity), deltaQty: String(drift),
            note: "Brought in from Shopify: Shopify's count.",
          },
        })] : []),
        db.productVariant.update({ where: { id: variantId }, data: { onHandQty: String(v.inventoryQuantity) } }),
      ])
      counts.push(`${label}: ${v.inventoryQuantity}`)
    }
  }
  // A numbered style's new variants get their SKUs where every part is
  // confirmed (lib/style-admin.ts); what is missing is said, not guessed.
  const { assignSkus } = await import('@/lib/style-admin')
  const skus = created.length ? await assignSkus(product.id) : null
  return { imported: true, productId: product.id, product: product.name, created, linked, alreadyIn, counts, ...(skus?.ok ? { skus } : {}) }
}
