import { REKEY } from '@/lib/style-rekey'
import { OLD_SKU_RE, SKU_RE } from '@/lib/style-system'

/**
 * Shopify's SKUs to the 16 Oct 2026 style numbers (Prompt 4, Part 4). The new
 * SKU is the old one with its style prefix swapped per the re-key table
 * (TP101-BLK-01 → TCO101-BLK-01). Where one old number became two (BG101 to
 * HCB101 and HCD101), the app's own re-key plan says which, by the exact old
 * SKU. Pure: scripts/rekey-shopify-skus.ts fetches, applies and verifies.
 *
 * Only the SKU field ever changes. A pattern code never goes near a SKU.
 */

export type StoreVariant = { variantId: string; productId: string; handle: string; title: string; sku: string }
export type SkuChange = StoreVariant & { newSku: string }
export type SkuSkip = StoreVariant & { reason: string }

export function planShopifySkus(variants: StoreVariant[], appPlan: Map<string, string>) {
  const change: SkuChange[] = []
  const skip: SkuSkip[] = []
  const problems: string[] = []
  for (const v of variants) {
    const sku = v.sku.trim()
    if (!sku) { skip.push({ ...v, reason: 'no SKU' }); continue }
    if (SKU_RE.test(sku)) { skip.push({ ...v, reason: 'already on the new system' }); continue }
    if (!OLD_SKU_RE.test(sku)) { skip.push({ ...v, reason: 'not a style-number SKU (legacy or archived listing); left as it is' }); continue }
    const style = sku.split('-')[0]
    const rows = REKEY.filter((r) => r.from === style)
    if (!rows.length) { skip.push({ ...v, reason: `${style} is not in the re-key table` }); problems.push(`${v.handle} / ${v.title}: ${sku}, style ${style} is not in the re-key table.`); continue }
    const tos = rows.map((r) => r.to).filter((t): t is string => !!t)
    if (!tos.length) { skip.push({ ...v, reason: `${style} (${rows[0].name}) has no new number yet` }); continue }
    let newSku: string | undefined
    if (tos.length === 1) newSku = `${tos[0]}${sku.slice(style.length)}`
    else {
      newSku = appPlan.get(sku)
      if (!newSku) { skip.push({ ...v, reason: `${style} split into ${tos.join(' and ')}; the app does not say which this colour is` }); problems.push(`${v.handle} / ${v.title}: ${sku} could be ${tos.join(' or ')}.`); continue }
    }
    const app = appPlan.get(sku)
    if (app && app !== newSku) problems.push(`${v.handle} / ${v.title}: ${sku} would be ${newSku} here but ${app} in the app.`)
    if (!SKU_RE.test(newSku)) problems.push(`${v.handle} / ${v.title}: ${newSku} does not pass the SKU format.`)
    change.push({ ...v, newSku })
  }
  // No two variants may end on one SKU, counting the ones left alone.
  const seen = new Map<string, string>()
  for (const [sku, who] of [...change.map((c) => [c.newSku, `${c.handle} / ${c.title}`] as const), ...skip.filter((s) => s.sku.trim()).map((s) => [s.sku.trim(), `${s.handle} / ${s.title}`] as const)]) {
    if (seen.has(sku)) problems.push(`Duplicate SKU ${sku}: ${seen.get(sku)} and ${who}.`)
    else seen.set(sku, who)
  }
  if (change.length + skip.length !== variants.length) problems.push(`Counts do not add up: ${change.length} + ${skip.length} ≠ ${variants.length}.`)
  return { change, skip, problems }
}
