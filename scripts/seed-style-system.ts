/**
 * Seed the style system from docs/style-system (8 Oct 2026): styles, code
 * tables, each product's style, and each variant's new SKU, matched on
 * product, colour and size. Never on the old SKU, which most variants lack.
 *
 *   npx tsx scripts/seed-style-system.ts            print the match report
 *   npx tsx scripts/seed-style-system.ts --apply    and write it
 *
 * Nothing is forced. An unmatched or ambiguous item, and each decision still
 * open, becomes a question on the To tend to list. The old SKU field is never
 * touched; sent POs are already frozen (lib/po-snapshot.ts) and must stay so.
 * Safe to run twice: everything is upserted, and a question is not raised
 * again while the same one is open.
 */
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import { matchVariants, parseCsv, skuProblem, sizeCodeFor, styleStatus, type AppVariant, type SkuRow } from '@/lib/style-system'

const DIR = 'docs/style-system'
const apply = process.argv.includes('--apply')

/**
 * App products under a different name from the files, from the decisions
 * already made (Brandon, 8 Oct 2026) and the build prompt: Mouse's "Cosmo
 * Stripe Tee" is TP102, "Hair Tie" AC103, "Red Bag" the Red Bean Bag BG105,
 * the five Cleo Bag products (and the retired parent) BG101, the two body
 * products PT101 and PT102.
 */
const PRODUCT_STYLE: Record<string, string> = {
  'Cosmo Stripe Tee': 'TP102',
  'Hair Tie': 'AC103',
  'Red Bag': 'BG105',
  'Cleo Bag': 'BG101',
  'Bateau Body — Muslin Canvas (part)': 'PT101',
  'Petite Bateau Body — Muslin Canvas (part)': 'PT102',
}
const styleForName = (name: string, styles: Map<string, string>): string | null =>
  PRODUCT_STYLE[name] ?? (name.startsWith('Cleo Bag — ') ? 'BG101' : styles.get(name) ?? null)

/** Codes the files mark as not settled: Intimates is proposed, FLG a placeholder, Pink and Purple assumed. */
const PROPOSED_CODES: Record<string, string> = {
  'CATEGORY:IN': 'New category Intimates, proposed in styles.csv.',
  'COLOR:FLG': 'Placeholder for the Cachet (floral and gold), per style-system.md.',
  'COLOR:PNK': 'Assumed for the 5to7 Skirt and Cleo Underwear, per skus.csv.',
  'COLOR:PRP': 'Assumed for the 5to7 Skirt, per skus.csv.',
}

async function main() {
  const styles = parseCsv(readFileSync(`${DIR}/styles.csv`, 'utf8'))
  const codes = parseCsv(readFileSync(`${DIR}/codes.csv`, 'utf8'))
  const skuRows: SkuRow[] = parseCsv(readFileSync(`${DIR}/skus.csv`, 'utf8')).map((r) => ({
    sku: r.sku_new, style: r.style_number, color: r.color_code, colorway: r.colorway, size: r.size_code, variantTitle: r.shopify_variant_title,
  }))

  // Check the files before anything else: every SKU well formed, equal to its parts, and unique.
  const seen = new Set<string>()
  for (const r of skuRows) {
    const p = skuProblem(r.sku, { style: r.style, color: r.color, size: r.size }, seen)
    if (p) throw new Error(`skus.csv: ${p}`)
    seen.add(r.sku)
  }
  const badStatus = styles.filter((s) => !styleStatus(s.status))
  if (badStatus.length) throw new Error(`styles.csv: unknown status ${badStatus.map((s) => s.status).join(', ')}`)

  const products = await db.product.findMany({ include: { colorways: true, variants: { include: { colorway: true } } } })
  const nameToStyle = new Map(styles.map((s) => [s.name, s.style_number]))
  const byStyle = new Map<string, Set<string>>()
  const unnumbered: string[] = []
  for (const p of products) {
    const st = styleForName(p.name, nameToStyle)
    if (st) byStyle.set(st, (byStyle.get(st) ?? new Set()).add(p.id))
    else unnumbered.push(p.name)
  }

  const codeStatus = (type: string, code: string) => (PROPOSED_CODES[`${type}:${code}`] ? 'PROPOSED' : 'CONFIRMED')
  const proposedStyles = new Set(styles.filter((s) => styleStatus(s.status) === 'PROPOSED').map((s) => s.style_number))
  // A SKU is only assigned when every part of it is settled.
  const usable = (r: SkuRow) => !proposedStyles.has(r.style) && codeStatus('COLOR', r.color) === 'CONFIRMED' && codeStatus('SIZE', r.size) === 'CONFIRMED' &&
    codeStatus('CATEGORY', r.style.slice(0, 2)) === 'CONFIRMED'

  const variants: AppVariant[] = products.flatMap((p) => p.variants.map((v) => ({ id: v.id, productId: p.id, productName: p.name, colorway: v.colorway?.customerName ?? null, size: v.size })))
  const report = matchVariants(skuRows, variants, byStyle)
  const withheld = report.matched.filter((m) => !usable(m.row))
  const assign = report.matched.filter((m) => usable(m.row))

  // ── Report ──
  const nameOf = new Map(products.map((p) => [p.id, p.name]))
  console.log(`\nMATCH REPORT (${apply ? 'applying' : 'dry run, nothing written'})`)
  console.log(`\nProducts given a style: ${[...byStyle].map(([s, ids]) => `${s} ← ${[...ids].map((i) => nameOf.get(i)).join(' + ')}`).join('; ')}`)
  console.log(`Products with no style: ${unnumbered.join(', ') || 'none'}`)
  console.log(`\nMatched and assigned (${assign.length}):`)
  for (const m of assign) console.log(`  ${m.row.sku}  ←  ${m.variant.productName} / ${m.variant.colorway ?? '(no colourway)'} / ${m.variant.size ?? '(no size)'}`)
  console.log(`\nMatched but held back, a code or style is not confirmed (${withheld.length}):`)
  for (const m of withheld) console.log(`  ${m.row.sku}  ←  ${m.variant.productName} / ${m.variant.colorway ?? '-'} / ${m.variant.size ?? '-'}`)
  console.log(`\nAmbiguous (${report.ambiguous.length}):`)
  for (const a of report.ambiguous) console.log(`  ${a.row?.sku ?? `${a.variant!.productName} / ${a.variant!.colorway} / ${a.variant!.size}`}: could be ${a.candidates.join(' | ')}`)
  console.log(`\nIn the files, nothing in the app to match (${report.unmatchedRows.length}):`)
  for (const r of report.unmatchedRows) console.log(`  ${r.sku}  (${r.colorway}, ${r.size})`)
  console.log(`\nIn the app under a numbered style, nothing in the files to match (${report.unmatchedVariants.length}):`)
  for (const v of report.unmatchedVariants) console.log(`  ${v.productName} / ${v.colorway ?? '(no colourway)'} / ${v.size ?? '(no size)'}`)

  // No row matched twice, by construction; checked anyway before writing.
  const twice = assign.map((m) => m.variant.id).filter((id, i, a) => a.indexOf(id) !== i)
  if (twice.length) throw new Error(`a variant matched twice: ${twice.join(', ')}`)
  if (!apply) return

  // ── Write ──
  for (const c of codes) {
    const type = c.type === 'category' ? 'CATEGORY' : c.type === 'color' ? 'COLOR' : 'SIZE'
    const status = codeStatus(type, c.code)
    await db.styleCode.upsert({
      where: { type_code: { type, code: c.code } },
      create: { type, code: c.code, name: c.name, legacyCode: c.legacy_code || null, status, notes: PROPOSED_CODES[`${type}:${c.code}`] ?? null },
      update: { name: c.name, legacyCode: c.legacy_code || null },
    })
  }
  const styleIds = new Map<string, string>()
  for (const s of styles) {
    const row = await db.style.upsert({
      where: { number: s.style_number },
      create: { number: s.style_number, name: s.name, categoryCode: s.category_code, status: styleStatus(s.status)!, sizes: s.sizes || null, notes: s.notes || null },
      update: { name: s.name, categoryCode: s.category_code, sizes: s.sizes || null, notes: s.notes || null },
    })
    styleIds.set(s.style_number, row.id)
  }
  for (const [st, ids] of byStyle) await db.product.updateMany({ where: { id: { in: [...ids] } }, data: { styleId: styleIds.get(st)! } })
  for (const m of report.matched) {
    // Codes go on every matched variant; the SKU only when every part is settled.
    await db.productVariant.update({
      where: { id: m.variant.id },
      data: { colorCode: m.row.color, sizeCode: sizeCodeFor(m.variant.size), ...(usable(m.row) ? { newSku: m.row.sku } : {}) },
    })
  }
  // A colourway gets the code all its matched variants share.
  const byColorway = new Map<string, Set<string>>()
  const variantColorway = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, v.colorwayId])))
  for (const m of report.matched) {
    const cw = variantColorway.get(m.variant.id)
    if (cw) byColorway.set(cw, (byColorway.get(cw) ?? new Set()).add(m.row.color))
  }
  for (const [cw, cs] of byColorway) if (cs.size === 1) await db.colorway.update({ where: { id: cw }, data: { colorCode: [...cs][0] } })

  console.log(`\nWrote ${codes.length} codes, ${styles.length} styles, ${[...byStyle.values()].reduce((a, s) => a + s.size, 0)} product links, ${assign.length} new SKUs, ${report.matched.length} variants coded.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
