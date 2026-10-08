/**
 * Put Shopify's variant SKUs back to what a backup CSV says (the style-number
 * switch, 8 Oct 2026). Changes the SKU field and nothing else: no title,
 * price, stock or status is sent. A variant already holding its backed-up
 * SKU is skipped, so it is safe to run twice.
 *
 *   npx tsx scripts/restore-shopify-skus.ts <backup.csv>            dry run: prints every change
 *   npx tsx scripts/restore-shopify-skus.ts <backup.csv> --apply    sends them (needs the Shopify env)
 *
 * The backup is the CSV taken before the switch (columns product_id,
 * handle, variant_id, variant_title, sku, ...); a copy is kept in the app's
 * Files area as "Shopify SKU backup before the style-number switch".
 */
import { readFileSync } from 'node:fs'
import { parseCsv } from '@/lib/style-system'

type Row = { product_id: string; handle: string; variant_id: string; variant_title: string; sku: string }

const MUTATION = `mutation SkuOnly($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
    productVariants { id sku } userErrors { field message } } }`

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!file) throw new Error('give the backup CSV')
  const rows = parseCsv(readFileSync(file, 'utf8')) as unknown as Row[]
  if (!rows.length || !('variant_id' in rows[0]) || !('sku' in rows[0])) throw new Error('that is not the backup CSV')

  // What Shopify holds now, when we can ask; in a dry run without the
  // Shopify env, every row is listed as it would be sent.
  let current = new Map<string, string | null>()
  if (apply || process.env.SHOPIFY_STORE_DOMAIN) {
    const { shopifyGraphQL } = await import('@/lib/integrations/shopify')
    let after: string | null = null
    do {
      const d: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Array<{ id: string; sku: string | null }> } } =
        await shopifyGraphQL(`query($after: String) { productVariants(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id sku } } }`, { after })
      for (const n of d.productVariants.nodes) current.set(n.id, n.sku)
      after = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null
    } while (after)
  } else current = new Map()

  const byProduct = new Map<string, Row[]>()
  for (const r of rows) {
    const now = current.has(r.variant_id) ? current.get(r.variant_id) ?? '' : null
    if (now !== null && now === r.sku) continue // already as backed up
    byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r])
  }
  const total = [...byProduct.values()].reduce((a, b) => a + b.length, 0)
  console.log(`${apply ? 'RESTORING' : 'DRY RUN'}: ${total} variant${total === 1 ? '' : 's'} on ${byProduct.size} product${byProduct.size === 1 ? '' : 's'}${current.size ? '' : ' (Shopify not consulted: every row listed)'}`)
  for (const [, rs] of byProduct) for (const r of rs) console.log(`  ${r.handle} / ${r.variant_title}: ${current.get(r.variant_id) ?? '(now unknown)'} -> ${r.sku || '(blank)'}`)
  if (!apply) return

  const { shopifyGraphQL } = await import('@/lib/integrations/shopify')
  for (const [productId, rs] of byProduct) {
    const res: { productVariantsBulkUpdate: { userErrors: Array<{ message: string }> } } = await shopifyGraphQL(MUTATION, {
      productId, variants: rs.map((r) => ({ id: r.variant_id, inventoryItem: { sku: r.sku } })),
    })
    const errs = res.productVariantsBulkUpdate.userErrors
    console.log(`  ${rs[0].handle}: ${errs.length ? `FAILED ${errs.map((e) => e.message).join('; ')}` : 'restored'}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
