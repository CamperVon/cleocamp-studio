/**
 * Shopify's variant SKUs to the 16 Oct 2026 style numbers (Prompt 4, Part 4).
 * Changes the SKU field and nothing else: no title, handle, price, stock,
 * option or status is sent. The plan is lib/shopify-sku-rekey.ts (pure,
 * tested).
 *
 *   npx tsx scripts/rekey-shopify-skus.ts --out <dir>
 *       Backup + dry run. Writes shopify-backup-<time>.csv (every variant) and
 *       shopify-sku-plan-<time>.csv (old → new) to <dir>, which must be
 *       outside the repo, and prints the table. Changes nothing.
 *   npx tsx scripts/rekey-shopify-skus.ts --apply <backup.csv>
 *       Refuses unless Shopify still matches that backup exactly. Sends the
 *       SKUs, then verifies against the backup.
 *   npx tsx scripts/rekey-shopify-skus.ts --plan <backup.csv> --out <dir>
 *       Dry run from a backup taken some other way (e.g. through the Shopify
 *       connector, where this session has no Shopify key). Writes the plan
 *       and the exact productVariantsBulkUpdate inputs, SKU only, to <dir>.
 *   npx tsx scripts/rekey-shopify-skus.ts --verify <backup.csv>
 *       Compares the store with the backup: only SKUs may differ, and each
 *       to exactly its planned new SKU.
 *
 * Rollback: scripts/restore-shopify-skus.ts <backup.csv> (dry run), then
 * with --apply. It puts every SKU back to the backup's and touches nothing else.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '@/lib/db'
import { parseCsv } from '@/lib/style-system'
import { planRekey } from '@/lib/style-rekey'
import { planShopifySkus, type StoreVariant } from '@/lib/shopify-sku-rekey'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined }
const COLS = ['product_id', 'handle', 'variant_id', 'variant_title', 'sku', 'inventory_item_id', 'product_title', 'product_status', 'price', 'compare_at_price', 'barcode', 'options', 'inventory_quantity', 'tracked'] as const
type Row = Record<(typeof COLS)[number], string>
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'

type Node = {
  id: string; title: string; sku: string | null; price: string; compareAtPrice: string | null; barcode: string | null; inventoryQuantity: number | null
  selectedOptions: Array<{ name: string; value: string }>
  product: { id: string; handle: string; title: string; status: string }
  inventoryItem: { id: string; tracked: boolean }
}

async function storeRows(): Promise<Row[]> {
  const { shopifyGraphQL } = await import('@/lib/integrations/shopify')
  const rows: Row[] = []
  let after: string | null = null
  do {
    const d: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Node[] } } = await shopifyGraphQL(
      `query($after: String) { productVariants(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes {
        id title sku price compareAtPrice barcode inventoryQuantity selectedOptions { name value }
        product { id handle title status } inventoryItem { id tracked } } } }`, { after })
    for (const n of d.productVariants.nodes) {
      rows.push({
        product_id: n.product.id, handle: n.product.handle, variant_id: n.id, variant_title: n.title, sku: n.sku ?? '',
        inventory_item_id: n.inventoryItem.id, product_title: n.product.title, product_status: n.product.status,
        price: n.price, compare_at_price: n.compareAtPrice ?? '', barcode: n.barcode ?? '',
        options: n.selectedOptions.map((o) => `${o.name}=${o.value}`).join('; '), inventory_quantity: String(n.inventoryQuantity ?? ''), tracked: String(n.inventoryItem.tracked),
      })
    }
    after = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null
  } while (after)
  return rows.sort((a, b) => `${a.handle}${a.variant_title}`.localeCompare(`${b.handle}${b.variant_title}`))
}

/** The app's own old → new SKU for each variant: after its re-key from previousSku, before it from the plan. */
async function appPlan(): Promise<Map<string, string>> {
  const [styles, variants, done] = await Promise.all([
    db.style.findMany({ select: { id: true, number: true, name: true, status: true, sizes: true, notes: true, products: { select: { id: true, name: true } } } }),
    db.productVariant.findMany({ select: { id: true, productId: true, newSku: true, colorCode: true, sizeCode: true } }),
    // Before the app's own re-key migration, previousSku is not there yet.
    db.productVariant.findMany({ where: { previousSku: { not: null }, newSku: { not: null } }, select: { previousSku: true, newSku: true } }).catch(() => []),
  ])
  if (done.length) return new Map(done.map((v) => [v.previousSku!, v.newSku!]))
  return new Map(planRekey(styles, variants).skus.map((s) => [s.from, s.to]))
}

const asStore = (r: Row): StoreVariant => ({ variantId: r.variant_id, productId: r.product_id, handle: r.handle, title: r.variant_title, sku: r.sku })
const readBackup = (file: string) => { const rows = parseCsv(readFileSync(file, 'utf8')) as unknown as Row[]; if (!rows.length || !('variant_id' in rows[0])) throw new Error('that is not a backup CSV'); return rows }

function verify(backup: Row[], now: Row[], planned: Map<string, string>) {
  const issues: string[] = []
  const byId = new Map(now.map((r) => [r.variant_id, r]))
  if (now.length !== backup.length) issues.push(`The store has ${now.length} variants; the backup has ${backup.length}.`)
  for (const b of backup) {
    const n = byId.get(b.variant_id)
    if (!n) { issues.push(`${b.handle} / ${b.variant_title}: gone from the store.`); continue }
    for (const k of COLS) if (k !== 'sku' && k !== 'inventory_quantity' && n[k] !== b[k]) issues.push(`${b.handle} / ${b.variant_title}: ${k} was ${b[k]}, now ${n[k]}.`)
    const want = planned.get(b.variant_id) ?? b.sku
    if (n.sku !== want) issues.push(`${b.handle} / ${b.variant_title}: SKU ${n.sku}, expected ${want}.`)
  }
  return issues
}

const MUTATION = `mutation SkuOnly($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
    productVariants { id sku } userErrors { field message } } }`

function report(plan: ReturnType<typeof planShopifySkus>, total: number) {
  console.log(`DRY RUN: ${plan.change.length} to change, ${plan.skip.length} skipped, ${total} in the store.`)
  for (const c of plan.change) console.log(`  ${c.sku.padEnd(16)} → ${c.newSku.padEnd(17)} ${c.handle} / ${c.title}`)
  console.log('\nSkipped:')
  for (const s of plan.skip) console.log(`  ${(s.sku || '(none)').padEnd(22)} ${s.handle} / ${s.title}: ${s.reason}`)
  console.log(plan.problems.length ? `\nPROBLEMS:\n${plan.problems.map((p) => `  - ${p}`).join('\n')}` : '\nChecks: no duplicate SKUs in the store, every new SKU passes the format, counts add up.')
}

async function main() {
  const out = arg('--out'), applyFile = arg('--apply'), verifyFile = arg('--verify'), planFrom = arg('--plan')
  if (planFrom) {
    if (!out || resolve(out).startsWith(resolve('.'))) throw new Error('give --out <dir> outside the repo')
    const backup = readBackup(planFrom)
    const plan = planShopifySkus(backup.map(asStore), await appPlan())
    report(plan, backup.length)
    const byProduct = new Map<string, Array<{ id: string; inventoryItem: { sku: string } }>>()
    for (const c of plan.change) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), { id: c.variantId, inventoryItem: { sku: c.newSku } }])
    const base = planFrom.replace(/\.csv$/, '').replace(/.*\//, '').replace('shopify-backup-', '')
    writeFileSync(`${resolve(out)}/shopify-sku-plan-${base}.csv`, csv([['handle', 'variant', 'old_sku', 'new_sku', 'skipped_because'], ...plan.change.map((c) => [c.handle, c.title, c.sku, c.newSku, '']), ...plan.skip.map((s) => [s.handle, s.title, s.sku, '', s.reason])]))
    writeFileSync(`${resolve(out)}/shopify-sku-mutations-${base}.json`, JSON.stringify([...byProduct].map(([productId, variants]) => ({ productId, variants })), null, 1))
    return
  }
  const [now, plan0] = await Promise.all([storeRows(), appPlan()])
  const plan = planShopifySkus(now.map(asStore), plan0)

  if (verifyFile || applyFile) {
    const backup = readBackup((verifyFile ?? applyFile)!)
    const fromBackup = planShopifySkus(backup.map(asStore), plan0)
    const planned = new Map(fromBackup.change.map((c) => [c.variantId, c.newSku]))
    if (verifyFile) {
      const issues = verify(backup, now, planned)
      console.log(issues.length ? `VERIFY FAILED (${issues.length}):\n${issues.map((i) => `  - ${i}`).join('\n')}` : `Verified: ${backup.length} variants, only SKUs changed, ${planned.size} to their new SKU.`)
      process.exitCode = issues.length ? 1 : 0
      return
    }
    // Apply: the store must still be exactly what was backed up and shown.
    const drift = verify(backup, now, new Map())
    if (drift.length) { console.log(`Not applied: the store changed since the backup.\n${drift.map((i) => `  - ${i}`).join('\n')}`); process.exitCode = 1; return }
    if (fromBackup.problems.length) { console.log(`Not applied:\n${fromBackup.problems.map((p) => `  - ${p}`).join('\n')}`); process.exitCode = 1; return }
    const { shopifyGraphQL } = await import('@/lib/integrations/shopify')
    const byProduct = new Map<string, typeof fromBackup.change>()
    for (const c of fromBackup.change) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), c])
    let failed = 0
    for (const [productId, cs] of byProduct) {
      const res: { productVariantsBulkUpdate: { userErrors: Array<{ message: string }> } } = await shopifyGraphQL(MUTATION, { productId, variants: cs.map((c) => ({ id: c.variantId, inventoryItem: { sku: c.newSku } })) })
      const errs = res.productVariantsBulkUpdate.userErrors
      if (errs.length) failed++
      console.log(`  ${cs[0].handle}: ${errs.length ? `FAILED ${errs.map((e) => e.message).join('; ')}` : `${cs.length} SKU${cs.length === 1 ? '' : 's'} updated`}`)
    }
    const issues = verify(backup, await storeRows(), planned)
    console.log(issues.length ? `\nVERIFY FAILED (${issues.length}):\n${issues.map((i) => `  - ${i}`).join('\n')}\nRoll back with scripts/restore-shopify-skus.ts ${applyFile} --apply` : `\nApplied and verified: ${planned.size} SKUs changed, nothing else.`)
    process.exitCode = failed || issues.length ? 1 : 0
    return
  }

  if (!out) throw new Error('give --out <dir> (outside the repo) for the backup')
  if (resolve(out).startsWith(resolve('.'))) throw new Error('the backup goes outside the repo')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupFile = `${resolve(out)}/shopify-backup-${stamp}.csv`
  writeFileSync(backupFile, csv([[...COLS], ...now.map((r) => COLS.map((k) => r[k]))]))
  const planFile = `${resolve(out)}/shopify-sku-plan-${stamp}.csv`
  writeFileSync(planFile, csv([['handle', 'variant', 'old_sku', 'new_sku', 'skipped_because'], ...plan.change.map((c) => [c.handle, c.title, c.sku, c.newSku, '']), ...plan.skip.map((s) => [s.handle, s.title, s.sku, '', s.reason])]))

  console.log(`Backup: ${backupFile} (${now.length} variants)\nPlan: ${planFile}\n`)
  report(plan, now.length)
}

main().then(() => db.$disconnect(), async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
