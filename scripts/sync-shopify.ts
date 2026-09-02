/**
 * Pull the catalogue, on-hand counts and sales history from Shopify.
 *
 * Shopify is the master for finished goods, so this is a one-way read: nothing
 * here writes back. Variants are matched on shopifyVariantId; anything Shopify
 * has that we don't is reported rather than silently invented, because a new
 * variant usually means Cleo added a colourway and Studio Mouse should ask
 * about its bill of materials rather than guess.
 */
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { fetchAllVariants, fetchLocations, fetchSoldLines } from '../lib/integrations/shopify'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }),
})

async function main() {
  // ── locations ───────────────────────────────────────────────
  const locations = await fetchLocations()
  const stocked = locations.find((l) => /shop location/i.test(l.name)) ?? locations[0]
  await db.location.updateMany({
    where: { name: 'Studio' },
    data: { shopifyLocationId: stocked.id },
  })
  console.log(`locations: ${locations.map((l) => l.name).join(', ')}`)
  console.log(`  stock lives at "${stocked.name}" — recorded for write-through\n`)

  // ── variants and on-hand ────────────────────────────────────
  const variants = await fetchAllVariants()
  let matched = 0
  const unknown: string[] = []

  for (const v of variants) {
    const existing = await db.productVariant.findFirst({
      where: { shopifyVariantId: v.id.split('/').pop() },
    })
    if (!existing) {
      // Shopify holds a DRAFT duplicate of the Cleo Tee carrying 245 phantom
      // units. Confirmed with Brandon as incorrect, so it is never imported —
      // saying why here stops someone importing it in six months.
      const why = v.product.status === 'DRAFT' ? ' [draft — ignored]' : ''
      unknown.push(`${v.product.title} / ${v.title}${why}`)
      continue
    }
    await db.productVariant.update({
      where: { id: existing.id },
      data: {
        onHandQty: v.inventoryQuantity === null ? null : String(v.inventoryQuantity),
        retailPriceCents: Math.round(parseFloat(v.price) * 100),
      },
    })
    matched++
  }
  console.log(`variants: ${matched} updated from Shopify, ${unknown.length} not in our records`)
  if (unknown.length) unknown.forEach((u) => console.log(`  not imported: ${u}`))

  // ── sales history ───────────────────────────────────────────
  // Shopify went live in April 2026; read_all_orders lets us take the lot.
  console.log('\nfetching order history...')
  const lines = await fetchSoldLines('2026-03-01')

  const byKey = new Map<string, number>()
  for (const l of lines) {
    const id = l.variantId.split('/').pop()!
    byKey.set(`${id}|${l.date}`, (byKey.get(`${id}|${l.date}`) ?? 0) + l.quantity)
  }

  const ours = new Map(
    (await db.productVariant.findMany({ where: { shopifyVariantId: { not: null } } }))
      .map((v) => [v.shopifyVariantId!, v.id]),
  )

  let written = 0
  let skipped = 0
  for (const [key, units] of byKey) {
    const [shopifyId, date] = key.split('|')
    const variantId = ours.get(shopifyId)
    if (!variantId) { skipped++; continue }
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
    written++
  }

  const totalUnits = [...byKey.values()].reduce((a, b) => a + b, 0)
  const range = await db.salesSnapshot.aggregate({ _min: { date: true }, _max: { date: true } })
  console.log(`\nsales: ${written} variant-days written (${skipped} for variants we don't track)`)
  console.log(`  ${totalUnits} units sold across ${lines.length} order lines`)
  console.log(`  range: ${range._min.date?.toISOString().slice(0, 10)} to ${range._max.date?.toISOString().slice(0, 10)}`)

  const counted = await db.productVariant.count({ where: { onHandQty: { not: null } } })
  const total = await db.productVariant.count()
  console.log(`\non hand: ${counted}/${total} variants now have a real count from Shopify`)
}

main().then(() => db.$disconnect()).catch(async (e) => {
  console.error(e); await db.$disconnect(); process.exit(1)
})
