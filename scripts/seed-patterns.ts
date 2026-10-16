/**
 * The first pattern labels (Prompt 4, Part 2): TCO101-P1 and -P2 as Brandon
 * gave them, and P1 "current pattern" for every other style that has been
 * made, with one open question for who holds those. The plan is
 * lib/pattern-seed.ts (pure, tested); this applies it. Run after the re-key.
 *
 *   npx tsx scripts/seed-patterns.ts            dry run: prints the plan, changes nothing
 *   npx tsx scripts/seed-patterns.ts --apply    applies it, in one transaction
 *
 * A style that already has a pattern is left alone, so running it twice adds
 * nothing. Nothing here touches a variant, a SKU or Shopify.
 */
import { db } from '@/lib/db'
import { holderQuestion, planPatternSeed, type SeedStyle } from '@/lib/pattern-seed'

const APPLY = process.argv.includes('--apply')
const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })

async function main() {
  const [styles, runs, lines] = await Promise.all([
    db.style.findMany({ select: { id: true, number: true, name: true, _count: { select: { patterns: true } }, products: { select: { id: true } } } }),
    db.productionRun.findMany({ where: { vendorId: { not: null } }, select: { productId: true, startedAt: true, createdAt: true, vendor: { select: { name: true } } } }),
    db.purchaseOrderLine.findMany({
      where: { productVariantId: { not: null }, purchaseOrder: { status: { not: 'CANCELLED' }, vendor: { role: 'MANUFACTURER' } } },
      select: { productVariant: { select: { productId: true } }, purchaseOrder: { select: { poNumber: true, orderedAt: true, createdAt: true, vendor: { select: { name: true } } } } },
    }),
  ])
  const seed: SeedStyle[] = styles.map((s) => {
    const ids = new Set(s.products.map((p) => p.id))
    return {
      id: s.id, number: s.number, name: s.name, patternCount: s._count.patterns,
      makers: [
        ...runs.filter((r) => ids.has(r.productId)).map((r) => { const at = r.startedAt ?? r.createdAt; return { vendor: r.vendor!.name, at, ref: `run started ${day(at)}` } }),
        ...lines.filter((l) => ids.has(l.productVariant!.productId)).map((l) => ({ vendor: l.purchaseOrder.vendor.name, at: l.purchaseOrder.orderedAt ?? l.purchaseOrder.createdAt, ref: `PO ${l.purchaseOrder.poNumber}` })),
      ],
    }
  })
  const plan = planPatternSeed(seed)

  console.log(`Patterns to add: ${plan.create.length}`)
  for (const p of plan.create) console.log(`  ${p.code}  ${p.description}  held by: ${p.heldBy ?? 'unknown'}`)
  for (const s of plan.skipped) console.log(`  skipped: ${s}`)
  const q = plan.unknownHolder.length ? holderQuestion(plan.unknownHolder) : null
  if (q) console.log(`\nOpen question: ${q.title}\n${q.detail}`)
  if (plan.problems.length) { console.log('\nPROBLEMS (nothing applied):'); for (const p of plan.problems) console.log(`  - ${p}`); process.exitCode = 1; return }
  if (!APPLY) { console.log('\nDry run: nothing changed. Run with --apply to apply.'); return }

  await db.$transaction(async (tx) => {
    await tx.pattern.createMany({ data: plan.create })
    if (q) await tx.actionItem.create({ data: { kind: 'QUESTION', source: 'SYSTEM', entityType: 'GENERAL', title: q.title, detail: q.detail } })
  })
  console.log('\nApplied.')
}

main().then(() => db.$disconnect(), async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
