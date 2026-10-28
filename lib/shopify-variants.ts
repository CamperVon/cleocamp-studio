import { db } from '@/lib/db'
import { shopifyGraphQL } from '@/lib/integrations/shopify'

/**
 * Adding a size or colour to a product that is already on Shopify (Brandon,
 * 28 Oct 2026: "mouse needs to be able to do this"). Until then Mouse could
 * only read Shopify's variants, so a PO for a Cosmo Tee in sizes 5 and 6
 * stopped at "add them in Shopify by hand, then tell me", with a to-do for
 * Brandon. Now the variant is made in Shopify first (Shopify stays the master
 * for finished goods, CLAUDE.md §3), at 0 stock, priced and set up for
 * shipping like a sibling of the same colour, then pulled in and linked the
 * way any Shopify variant is, so its count writes back. Its SKU, once the
 * style's codes give one, is written onto the Shopify variant too.
 *
 * The price is copied from a Shopify sibling, never worked out: a larger
 * size that should cost more is changed in Shopify and the sync brings it in.
 */

type Opt = { name: string; value: string }
export type ShopifySibling = {
  id: string
  price: string
  compareAtPrice: string | null
  inventoryPolicy: string
  taxable: boolean
  selectedOptions: Opt[]
  inventoryItem: {
    tracked: boolean
    requiresShipping: boolean
    countryCodeOfOrigin: string | null
    harmonizedSystemCode: string | null
    measurement: { weight: { value: number; unit: string } | null } | null
  }
}

export type NewVariantPlan = {
  make: Array<{ label: string; optionValues: Array<{ optionName: string; name: string }>; like: ShopifySibling }>
  already: string[]
  problems: string[]
}

const isSize = (name: string) => /size/i.test(name)
const sizeRank = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : Infinity }

/**
 * Which variants to create in Shopify for these colours and sizes. Pure.
 * A product whose options are not one colour-type option and/or a Size
 * option is refused: guessing the third option's value would make a
 * variant nobody asked for.
 */
export function planNewVariants(optionNames: string[], existing: ShopifySibling[], colours: Array<string | null>, sizes: Array<string | null>): NewVariantPlan {
  const plan: NewVariantPlan = { make: [], already: [], problems: [] }
  const sizeOpt = optionNames.find(isSize) ?? null
  const colourOpts = optionNames.filter((n) => !isSize(n) && n !== 'Title')
  if (colourOpts.length > 1) { plan.problems.push(`It has more than one non-size option (${colourOpts.join(', ')}); add it in Shopify.`); return plan }
  if (!existing.length) { plan.problems.push('It has no variant in Shopify to copy price and shipping details from.'); return plan }
  const colourOpt = colourOpts[0] ?? null
  const valueOf = (v: ShopifySibling, opt: string | null) => (opt ? v.selectedOptions.find((o) => o.name === opt)?.value ?? null : null)
  for (const colour of colours) {
    for (const size of sizes) {
      const label = [colour, size].filter(Boolean).join(' / ') || 'the one variant'
      if (size && !sizeOpt) { plan.problems.push(`${label}: the product has no Size option in Shopify.`); continue }
      if (colour && !colourOpt) { plan.problems.push(`${label}: the product has no colour option in Shopify.`); continue }
      const same = (v: ShopifySibling) => (!colourOpt || valueOf(v, colourOpt)?.toLowerCase() === colour?.toLowerCase())
      if (existing.some((v) => same(v) && (!sizeOpt || valueOf(v, sizeOpt) === size))) { plan.already.push(label); continue }
      // The largest existing size of the same colour; else any variant.
      const like = existing.filter(same).sort((a, b) => sizeRank(valueOf(b, sizeOpt) ?? '') - sizeRank(valueOf(a, sizeOpt) ?? ''))[0] ?? existing[0]
      const optionValues = [
        ...(colourOpt ? [{ optionName: colourOpt, name: colour ?? valueOf(like, colourOpt)! }] : []),
        ...(sizeOpt ? [{ optionName: sizeOpt, name: size ?? valueOf(like, sizeOpt)! }] : []),
      ]
      plan.make.push({ label, optionValues, like })
    }
  }
  return plan
}

/** The Shopify input for one new variant: copied from its sibling, 0 at the studio. Pure. */
export function variantInput(m: NewVariantPlan['make'][number], locationId: string) {
  const ii = m.like.inventoryItem
  const w = ii.measurement?.weight
  return {
    optionValues: m.optionValues,
    price: m.like.price,
    ...(m.like.compareAtPrice ? { compareAtPrice: m.like.compareAtPrice } : {}),
    inventoryPolicy: m.like.inventoryPolicy,
    taxable: m.like.taxable,
    inventoryItem: {
      tracked: ii.tracked,
      requiresShipping: ii.requiresShipping,
      ...(ii.countryCodeOfOrigin ? { countryCodeOfOrigin: ii.countryCodeOfOrigin } : {}),
      ...(ii.harmonizedSystemCode ? { harmonizedSystemCode: ii.harmonizedSystemCode } : {}),
      ...(w ? { measurement: { weight: { value: w.value, unit: w.unit } } } : {}),
    },
    inventoryQuantities: [{ locationId, availableQuantity: 0 }],
  }
}

export type AddResult =
  | { ok: true; created: string[]; already: string[]; skus: string[]; price: string; skuProblems: string[] }
  | { ok: false; error: string }

/** Create these colour/size combinations in Shopify, then pull them into the app, linked. */
export async function addVariantsInShopify(productId: string, colours: Array<string | null>, sizes: Array<string | null>, actorId: string | null): Promise<AddResult> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { name: true, shopifyProductId: true } })
  if (!product?.shopifyProductId) return { ok: false, error: `${product?.name ?? productId} has no Shopify listing on record.` }
  const studio = await db.location.findFirst({ where: { isDefault: true }, select: { shopifyLocationId: true } })
  if (!studio?.shopifyLocationId) return { ok: false, error: 'The studio has no Shopify location on record, so stock could not be set.' }
  const gid = `gid://shopify/Product/${product.shopifyProductId}`

  const d = await shopifyGraphQL<{ product: { options: Array<{ name: string }>; variants: { nodes: ShopifySibling[] } } | null }>(
    `query($id: ID!) { product(id: $id) { options { name } variants(first: 100) { nodes { id price compareAtPrice inventoryPolicy taxable selectedOptions { name value }
      inventoryItem { tracked requiresShipping countryCodeOfOrigin harmonizedSystemCode measurement { weight { value unit } } } } } } }`,
    { id: gid },
  )
  if (!d.product) return { ok: false, error: `Shopify has no product ${product.shopifyProductId}.` }
  const plan = planNewVariants(d.product.options.map((o) => o.name), d.product.variants.nodes, colours, sizes)
  if (plan.problems.length) return { ok: false, error: `Nothing was made. ${plan.problems.join(' ')}` }
  if (!plan.make.length) return { ok: true, created: [], already: plan.already, skus: [], price: '', skuProblems: [] }

  const r = await shopifyGraphQL<{ productVariantsBulkCreate: { productVariants: Array<{ id: string; title: string }> | null; userErrors: Array<{ message: string }> } }>(
    `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkCreate(productId: $p, variants: $v) { productVariants { id title } userErrors { message } } }`,
    { p: gid, v: plan.make.map((m) => variantInput(m, studio.shopifyLocationId!)) },
  )
  const made = r.productVariantsBulkCreate.productVariants ?? []
  if (r.productVariantsBulkCreate.userErrors.length || !made.length) {
    return { ok: false, error: `Shopify refused: ${r.productVariantsBulkCreate.userErrors.map((e) => e.message).join('; ') || 'no reason given'}. Nothing was made.` }
  }

  // Pulled in the way any Shopify variant is: linked, with Shopify's 0, and
  // its SKU assigned where the style's codes are confirmed.
  const { fetchShopifyProduct, importShopifyProduct } = await import('@/lib/shopify-import')
  const p = await fetchShopifyProduct(product.shopifyProductId)
  if (p) await importShopifyProduct(p, { intoProductId: productId, actorId })

  const madeIds = made.map((v) => v.id.split('/').pop()!)
  const linked = await db.productVariant.findMany({ where: { shopifyVariantId: { in: madeIds } }, select: { id: true, shopifyVariantId: true, newSku: true } })
  const withSku = linked.filter((v) => v.newSku)
  const skuProblems: string[] = []
  if (withSku.length) {
    const u = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: Array<{ message: string }> } }>(
      `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`,
      { p: gid, v: withSku.map((v) => ({ id: `gid://shopify/ProductVariant/${v.shopifyVariantId}`, inventoryItem: { sku: v.newSku } })) },
    )
    if (u.productVariantsBulkUpdate.userErrors.length) skuProblems.push(`The SKU did not save on Shopify: ${u.productVariantsBulkUpdate.userErrors.map((e) => e.message).join('; ')}`)
    else await db.$transaction(withSku.map((v) => db.productVariant.update({ where: { id: v.id }, data: { shopifySku: v.newSku } })))
  }
  if (linked.length < made.length) skuProblems.push('Some new Shopify variants did not link in the app; run sync_shopify.')
  if (withSku.length < linked.length) skuProblems.push('Some have no SKU yet because a size or colour code is not confirmed.')
  return {
    ok: true,
    created: plan.make.map((m) => m.label),
    already: plan.already,
    skus: withSku.map((v) => v.newSku!),
    price: plan.make[0].like.price,
    skuProblems,
  }
}
