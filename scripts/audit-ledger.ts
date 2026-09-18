import { db } from '@/lib/db'

/**
 * Does the ledger still add up to the numbers on screen?
 *
 * CLAUDE.md §3: "onHandQty is a materialized sum of events... must be
 * recomputable from the ledger alone." Nobody had ever checked that it was,
 * and on 18 Sept 2026 the same question asked of incomingQty — another field
 * documented as derived — turned out to have the answer "no, by nothing at
 * all." So Brandon asked for this one to be checked properly.
 *
 * It found four components carrying stock the ledger could not account for:
 * COUNTED events written on 11 Sept with the right countedQty and a deltaQty
 * of 0, so the ledger recorded that a count had happened and that nothing had
 * changed. The figures on screen were right the whole time; only their
 * provenance was missing. The consequence, had it gone unnoticed, was narrow
 * and severe: anything that rebuilt on-hand from the ledger — the operation
 * the invariant exists to guarantee — would have silently zeroed 1,000 care
 * labels, 145 buttons, 20 zippers and 50 bag labels. Repaired with CORRECTION
 * events, since the ledger is append-only and the write bug behind it was
 * fixed on 14 Sept.
 *
 * Run it after anything that writes stock in bulk, or when a number looks
 * wrong:  npx tsx scripts/audit-ledger.ts
 *
 * Components must reconcile exactly. VARIANTS DELIBERATELY DO NOT: Shopify is
 * the master for finished goods and the sync writes their counts directly,
 * while the ledger holds only what Mouse was told about (a wholesale shipment,
 * a gift, a physical count). A variant differing from its ledger is the design,
 * not a fault, so they are reported separately and never as errors.
 */
async function main() {
  const [components, variants, events, locStock] = await Promise.all([
    db.component.findMany({ select: { id: true, name: true, category: true, onHandQty: true } }),
    db.productVariant.findMany({
      select: { id: true, size: true, onHandQty: true, product: { select: { name: true } }, colorway: { select: { customerName: true } } },
    }),
    db.inventoryEvent.findMany({ select: { componentId: true, productVariantId: true, deltaQty: true } }),
    db.componentLocationStock.findMany({ select: { componentId: true, qty: true } }),
  ])

  const sum = (rows: Array<{ id: string | null; qty: number }>) => {
    const m = new Map<string, number>()
    for (const r of rows) if (r.id) m.set(r.id, (m.get(r.id) ?? 0) + r.qty)
    return m
  }
  const byComponent = sum(events.map((e) => ({ id: e.componentId, qty: Number(e.deltaQty) })))
  const byVariant = sum(events.map((e) => ({ id: e.productVariantId, qty: Number(e.deltaQty) })))
  const byPlace = sum(locStock.map((s) => ({ id: s.componentId, qty: Number(s.qty) })))

  let failures = 0

  console.log('Components — stored on-hand vs the sum of their ledger')
  for (const c of components) {
    const stored = Number(c.onHandQty)
    const ledger = byComponent.get(c.id) ?? 0
    if (Math.abs(stored - ledger) < 0.001) continue
    failures++
    console.log(`  MISMATCH  ${c.name} [${c.category}]  stored ${stored}, ledger ${ledger}, out by ${(stored - ledger).toFixed(3)}`)
  }

  console.log('\nComponents — stored on-hand vs the sum of where it is held')
  for (const c of components) {
    const stored = Number(c.onHandQty)
    const places = byPlace.get(c.id) ?? 0
    if (Math.abs(stored - places) < 0.001) continue
    failures++
    console.log(`  MISMATCH  ${c.name}  stored ${stored}, places add to ${places}, out by ${(stored - places).toFixed(3)}`)
  }

  const drifted = variants.filter(
    (v) => v.onHandQty !== null && Math.abs(Number(v.onHandQty) - (byVariant.get(v.id) ?? 0)) >= 0.001,
  )
  console.log(
    `\nVariants — ${drifted.length} of ${variants.length} differ from their ledger. ` +
      'Expected: Shopify is the master for finished goods and writes these directly, ' +
      'so the ledger holds only what Mouse was told about. Not counted as failures.',
  )

  console.log(
    failures === 0
      ? '\nEverything components track reconciles with the ledger.'
      : `\n${failures} component figure${failures === 1 ? '' : 's'} cannot be rebuilt from the ledger.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
