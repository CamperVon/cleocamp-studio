/**
 * The 16 Oct 2026 style re-key (Prompt 4, Part 1): TP101-era numbers to the
 * new three-letter system, every SKU with them, the category letters, the
 * Cleo Bag Denim split, the two duplicate products merged, Dolce unnumbered.
 * The plan is lib/style-rekey.ts (pure, tested); this applies it.
 *
 *   npx tsx scripts/rekey-styles.ts            dry run: prints the plan, writes the crosswalk, changes nothing
 *   npx tsx scripts/rekey-styles.ts --apply    applies it, in one transaction
 *
 * Refuses to apply if the plan has any problem, or if it has run before.
 * Sent purchase orders are not touched: their lines keep the SKUs saved when
 * they were sent. Nothing is sent to Shopify (Part 4 does that, separately).
 */
import { writeFileSync } from 'node:fs'
import { db } from '@/lib/db'
import { MERGES, planRekey, REKEY } from '@/lib/style-rekey'
import { CATEGORIES } from '@/lib/style-system'

const APPLY = process.argv.includes('--apply')
const CROSSWALK = 'docs/style-system/crosswalk-2026-10-16.csv'

const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'

async function main() {
  const [styles, variants] = await Promise.all([
    db.style.findMany({ select: { id: true, number: true, name: true, status: true, sizes: true, notes: true, products: { select: { id: true, name: true } } } }),
    db.productVariant.findMany({ select: { id: true, productId: true, newSku: true, colorCode: true, sizeCode: true, sku: true, size: true, product: { select: { name: true } }, colorway: { select: { customerName: true } } } }),
  ])
  const plan = planRekey(styles, variants)

  // The duplicates: only what is known to be safe to move.
  const dupes = await Promise.all(MERGES.map(async ([dup, keep]) => {
    const [d, k] = await Promise.all([
      db.product.findFirst({ where: { name: dup }, select: { id: true, notes: true, _count: { select: { variants: true, colorways: true, productionRuns: true, forecasts: true, calendarEvents: true, purchaseOrders: true, kitParts: true, partOfKits: true } }, bomLines: { select: { id: true, componentId: true, size: true, colorway: true } } } }),
      db.product.findFirst({ where: { name: keep }, select: { id: true, bomLines: { select: { componentId: true, size: true, colorway: true } } } }),
    ])
    if (!d || !k) { plan.problems.push(`Merge ${dup} → ${keep}: one of them is missing.`); return null }
    const busy = Object.entries(d._count).filter(([, n]) => n > 0).map(([k2]) => k2)
    if (busy.length) plan.problems.push(`Merge ${dup} → ${keep}: ${dup} still has ${busy.join(', ')}; merge those by hand first.`)
    const sheet = await db.lineSheetRow.count({ where: { productId: d.id } })
    if (sheet) plan.problems.push(`Merge ${dup} → ${keep}: ${dup} is on the line sheet.`)
    const strayBom = d.bomLines.filter((b) => !k.bomLines.some((x) => x.componentId === b.componentId && x.size === b.size && x.colorway === b.colorway))
    if (strayBom.length) plan.problems.push(`Merge ${dup} → ${keep}: ${dup} has ${strayBom.length} materials line(s) ${keep} does not; merge them by hand first.`)
    return { dup, keep, dupId: d.id, keepId: k.id, notesField: d.notes, bomIds: d.bomLines.map((b) => b.id) }
  }))
  // Before the migration is applied the table is not there yet: a dry run still works.
  const already = await db.retiredStyleNumber.count().catch(() => 0)
  if (already) plan.problems.push(`The re-key has already run (${already} retired numbers on file).`)

  // The crosswalk: one row per variant with a SKU, and one per style with none.
  const toOf = new Map(plan.skus.map((s) => [s.id, s]))
  const productTo = new Map<string, { from: string | null; to: string | null }>()
  for (const r of REKEY) {
    const st = styles.find((s) => s.number === r.from)
    for (const name of r.products) { const p = st?.products.find((x) => x.name === name); if (p) productTo.set(p.id, { from: r.from, to: r.to }) }
  }
  const rows: string[][] = [['old_style', 'new_style', 'product', 'variant', 'legacy_sku', 'previous_sku', 'new_sku']]
  for (const r of REKEY) {
    const st = styles.find((s) => s.number === r.from)
    const ps = st ? st.products.filter((p) => r.products.includes(p.name)) : []
    const vs = variants.filter((v) => ps.some((p) => p.id === v.productId) && toOf.has(v.id))
      .sort((a, b) => `${a.product.name}${a.colorway?.customerName}${a.size}`.localeCompare(`${b.product.name}${b.colorway?.customerName}${b.size}`))
    if (!vs.length) rows.push([r.from ?? '', r.to ?? '(none)', r.products.join(' / ') || r.create?.product || r.name, '', '', '', ''])
    for (const v of vs) {
      const s = toOf.get(v.id)!
      rows.push([r.from ?? '', r.to ?? '', v.product.name, [v.colorway?.customerName, v.size].filter(Boolean).join(' / '), v.sku ?? '', s.from, s.to])
    }
  }
  writeFileSync(CROSSWALK, csv(rows))

  console.log(`Re-key plan: ${plan.renumber.length} styles renumbered, ${plan.create.length} created (${plan.create.map((c) => c.number).join(', ')}), ${plan.unlink.length} unnumbered (${plan.unlink.map((u) => u.name).join(', ')}), ${plan.retire.length} numbers retired, ${plan.skus.length} SKUs re-keyed, ${dupes.filter(Boolean).length} duplicates merged.`)
  console.log(`Crosswalk written to ${CROSSWALK} (${rows.length - 1} rows).`)
  for (const r of plan.renumber) console.log(`  ${r.from} → ${r.to}  ${r.name}`)
  if (plan.problems.length) { console.log('\nPROBLEMS (nothing applied):'); for (const p of plan.problems) console.log(`  - ${p}`); process.exitCode = 1; return }
  if (!APPLY) { console.log('\nDry run: nothing changed. Run with --apply to apply.'); return }

  await db.$transaction(async (tx) => {
    // Categories: the letter table replaces the two-letter one.
    await tx.styleCode.deleteMany({ where: { type: 'CATEGORY' } })
    await tx.styleCode.createMany({ data: CATEGORIES.map((c) => ({ type: 'CATEGORY' as const, code: c.code, name: c.name, status: 'CONFIRMED' as const, notes: c.reserved ? 'Reserved: not in use yet.' : null })) })

    for (const r of plan.renumber) await tx.style.update({ where: { id: r.id }, data: { number: r.to, categoryCode: r.category, name: r.name, notes: r.notes } })
    for (const c of plan.create) {
      const s = await tx.style.create({ data: { number: c.number, name: c.name, categoryCode: c.category, status: c.status as never, sizes: c.sizes, notes: c.notes } })
      if (c.productIds.length) await tx.product.updateMany({ where: { id: { in: c.productIds } }, data: { styleId: s.id } })
      if (c.createProduct) await tx.product.create({ data: { name: c.createProduct.name, status: c.createProduct.status, styleId: s.id, notes: c.notes } })
    }
    for (const u of plan.unlink) {
      await tx.product.update({ where: { id: u.productId }, data: { styleId: null } })
      // Brandon, 16 Oct 2026: "standby on dolce". A note, not a question: he is deciding.
      await tx.note.create({ data: { entityType: 'PRODUCT', entityId: u.productId, source: 'SYSTEM',
        content: `${u.name}'s style number ${u.from} was removed in the 16 Oct 2026 re-key. It is unnumbered on purpose: Brandon is on standby about it (16 Oct 2026). Do not propose a number or ask until he raises it.` } })
    }
    for (const r of plan.remove) await tx.style.delete({ where: { id: r.id } })
    await tx.retiredStyleNumber.createMany({ data: plan.retire })
    for (const s of plan.skus) await tx.productVariant.update({ where: { id: s.id }, data: { previousSku: s.from, newSku: s.to } })

    for (const m of dupes) {
      if (!m) continue
      const now = new Date()
      // Notes about the duplicate move to the real product, and are marked
      // superseded: "this record" no longer exists.
      await tx.note.updateMany({ where: { entityType: 'PRODUCT', entityId: m.dupId }, data: { entityId: m.keepId, supersededAt: now } })
      await tx.actionItem.updateMany({ where: { entityType: 'PRODUCT', entityId: m.dupId }, data: { entityId: m.keepId } })
      if (m.notesField?.trim()) await tx.note.create({ data: { entityType: 'PRODUCT', entityId: m.keepId, source: 'SYSTEM', content: `From the "${m.dup}" record, merged into ${m.keep} on 16 Oct 2026 (Brandon): ${m.notesField.trim()}` } })
      await tx.bomLine.deleteMany({ where: { id: { in: m.bomIds } } }) // each one already on the keeper (checked above)
      await tx.product.delete({ where: { id: m.dupId } })
    }
  }, { timeout: 120_000, maxWait: 20_000 })
  console.log('\nApplied.')
}

main().then(() => db.$disconnect(), async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
