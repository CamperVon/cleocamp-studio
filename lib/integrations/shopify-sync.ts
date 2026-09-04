/**
 * Shared body of the Shopify pull, used by both the nightly cron and the
 * one-off `npm run sync:shopify` script. Shopify is the master for finished
 * goods, so this is a one-way read: nothing here writes back.
 *
 * Variants are matched on shopifyVariantId; anything Shopify has that we
 * don't is reported rather than silently invented — a new variant usually
 * means Cleo added a colourway and Studio Mouse should ask about its bill of
 * materials rather than guess.
 */
import type { PrismaClient } from '@/generated/prisma/client'
import { fetchAllVariants, fetchLocations, fetchSoldLines } from './shopify'

export type ShopifySyncResult = {
  location: string | null
  variantsUpdated: number
  variantsUnknown: string[]
  salesWritten: number
  salesSkipped: number
  unitsSold: number
  onHandCounted: number
  onHandTotal: number
}

/**
 * @param sinceISO Earliest order date to pull sales for (store-timezone bare
 *   date, e.g. "2026-03-01"). The nightly cron passes a short trailing
 *   window — a few weeks is enough to catch corrections and late
 *   fulfilments without re-reading the whole order history every night.
 */
export async function syncShopify(db: PrismaClient, sinceISO: string): Promise<ShopifySyncResult> {
  // ── locations ───────────────────────────────────────────────
  const locations = await fetchLocations()
  const stocked = locations.find((l) => /shop location/i.test(l.name)) ?? locations[0]
  let location: string | null = null
  if (stocked) {
    await db.location.updateMany({
      where: { name: 'Studio' },
      data: { shopifyLocationId: stocked.id },
    })
    location = stocked.name
  }

  // ── variants and on-hand ────────────────────────────────────
  const variants = await fetchAllVariants()
  let variantsUpdated = 0
  const variantsUnknown: string[] = []

  for (const v of variants) {
    const existing = await db.productVariant.findFirst({
      where: { shopifyVariantId: v.id.split('/').pop() },
    })
    if (!existing) {
      // Shopify holds a DRAFT duplicate of the Cleo Tee carrying phantom
      // units. Confirmed with Brandon as incorrect, so it is never
      // imported — saying why here stops someone importing it in six months.
      const why = v.product.status === 'DRAFT' ? ' [draft — ignored]' : ''
      variantsUnknown.push(`${v.product.title} / ${v.title}${why}`)
      continue
    }
    await db.productVariant.update({
      where: { id: existing.id },
      data: {
        onHandQty: v.inventoryQuantity === null ? null : String(v.inventoryQuantity),
        retailPriceCents: Math.round(parseFloat(v.price) * 100),
        imageUrl: v.image?.url ?? v.product.featuredImage?.url ?? null,
        shopifyInventoryItemId: v.inventoryItem.id,
      },
    })
    variantsUpdated++
  }

  // ── sales history ───────────────────────────────────────────
  const lines = await fetchSoldLines(sinceISO)

  const byKey = new Map<string, number>()
  for (const l of lines) {
    const id = l.variantId.split('/').pop()!
    byKey.set(`${id}|${l.date}`, (byKey.get(`${id}|${l.date}`) ?? 0) + l.quantity)
  }

  const ours = new Map(
    (await db.productVariant.findMany({ where: { shopifyVariantId: { not: null } } }))
      .map((v) => [v.shopifyVariantId!, v.id]),
  )

  let salesWritten = 0
  let salesSkipped = 0
  for (const [key, units] of byKey) {
    const [shopifyId, date] = key.split('|')
    const variantId = ours.get(shopifyId)
    if (!variantId) { salesSkipped++; continue }
    await db.salesSnapshot.upsert({
      where: {
        productVariantId_date_source: {
          productVariantId: variantId,
          date: new Date(date + 'T00:00:00Z'),
          source: 'shopify',
        },
      },
      create: { productVariantId: variantId, date: new Date(date + 'T00:00:00Z'), unitsSold: units, source: 'shopify' },
      update: { unitsSold: units },
    })
    salesWritten++
  }

  const unitsSold = [...byKey.values()].reduce((a, b) => a + b, 0)
  const onHandCounted = await db.productVariant.count({ where: { onHandQty: { not: null } } })
  const onHandTotal = await db.productVariant.count()

  return {
    location, variantsUpdated, variantsUnknown,
    salesWritten, salesSkipped, unitsSold,
    onHandCounted, onHandTotal,
  }
}
