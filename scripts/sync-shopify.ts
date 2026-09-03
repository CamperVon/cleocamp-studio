/**
 * Pull the catalogue, on-hand counts and full sales history from Shopify.
 *
 * The nightly cron does this automatically every night with a short trailing
 * window. Run this by hand only for a first import or to rebuild the full
 * history — see lib/integrations/shopify-sync.ts for the shared logic.
 */
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { syncShopify } from '../lib/integrations/shopify-sync'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }),
})

async function main() {
  // Shopify went live in April 2026; read_all_orders lets us take the lot.
  const r = await syncShopify(db, '2026-03-01')

  console.log(`location: stock lives at "${r.location}" — recorded for write-through\n`)
  console.log(`variants: ${r.variantsUpdated} updated from Shopify, ${r.variantsUnknown.length} not in our records`)
  if (r.variantsUnknown.length) r.variantsUnknown.forEach((u) => console.log(`  not imported: ${u}`))

  console.log(`\nsales: ${r.salesWritten} variant-days written (${r.salesSkipped} for variants we don't track)`)
  console.log(`  ${r.unitsSold} units sold`)

  console.log(`\non hand: ${r.onHandCounted}/${r.onHandTotal} variants now have a real count from Shopify`)
}

main().then(() => db.$disconnect()).catch(async (e) => {
  console.error(e); await db.$disconnect(); process.exit(1)
})
