import { db } from '@/lib/db'

/**
 * Everything Studio Mouse knows, rendered for the system prompt.
 *
 * The whole catalogue goes in every turn rather than being retrieved. At this
 * scale it is a few thousand tokens, and it beats fuzzy matching — which fails
 * silently when "the pink one" doesn't substring-match a colourway called
 * "Rose". A miss is worse than the retrieval it replaces, because Claude then
 * answers without context it could have had.
 *
 * This block is cached, so it costs a tenth of the input rate after the first
 * turn. Keep it deterministic: no timestamps, stable ordering.
 */
export async function buildCatalog(): Promise<string> {
  const [products, components, vendors, items, pos, runs, lastSale, sales] = await Promise.all([
    db.product.findMany({
      orderBy: { name: 'asc' },
      include: {
        colorways: { orderBy: { customerName: 'asc' } },
        variants: { orderBy: [{ size: 'asc' }], include: { colorway: true } },
        bomLines: { include: { component: true } },
      },
    }),
    db.component.findMany({ orderBy: { name: 'asc' }, include: { vendor: true } }),
    db.vendor.findMany({ orderBy: { name: 'asc' } }),
    db.actionItem.findMany({ where: { resolved: false }, orderBy: { createdAt: 'asc' } }),
    db.purchaseOrder.findMany({
      where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
      include: { vendor: true, lines: { include: { component: true } } },
    }),
    db.productionRun.findMany({
      where: { status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      include: { product: true, vendor: true },
      orderBy: { expectedReadyAt: 'asc' },
    }),
    db.salesSnapshot.aggregate({ _max: { date: true } }),
    db.salesSnapshot.groupBy({
      by: ['productVariantId'],
      _sum: { unitsSold: true },
      where: { date: { gte: new Date(Date.now() - 56 * 864e5) } },
    }),
  ])

  const sold = new Map(sales.map((s) => [s.productVariantId, s._sum.unitsSold ?? 0]))
  const money = (c: number | null) => (c === null ? 'unknown' : `$${(c / 100).toFixed(2)}`)
  const L: string[] = []

  // Without this it cannot reason about lead times, due dates or "as of today",
  // and correctly refuses to guess — which means asking Cleo what day it is.
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date())
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  L.push(`## Today\n${today} (${iso}), Los Angeles time.\n`)

  // It could see the numbers but not where they came from, so asked whether
  // Shopify was connected while reading Shopify's own figures.
  L.push('## Where these numbers come from')
  L.push('Shopify is connected and is the master for finished goods. Variant counts,')
  L.push('retail prices and sales history are pulled from it and refreshed by the')
  L.push('nightly job. You can pull a fresh copy yourself with sync_shopify.')
  L.push(
    `Sales history currently runs to ${
      lastSale._max.date ? lastSale._max.date.toISOString().slice(0, 10) : 'no sales recorded'
    }.`,
  )
  L.push('WRITING BACK TO SHOPIFY IS NOT SWITCHED ON. You can read it; you cannot')
  L.push('change it. Say so plainly if asked to.')
  L.push('')

  L.push('## Products')
  for (const p of products) {
    L.push(`\n### ${p.name} [${p.id}] — ${p.status.toLowerCase()}, retail ${money(p.retailPriceCents)}`)
    L.push(`production lead time: ${p.productionLeadTimeDays ?? 'UNKNOWN'}`)
    if (p.notes) L.push(`note: ${p.notes}`)
    if (p.colorways.length) {
      L.push('colourways (what customers see / what the dye house calls it):')
      for (const c of p.colorways) {
        L.push(`  - ${c.customerName}${c.dyeHouseName ? ` / ${c.dyeHouseName}` : c.inHouseMatch ? ' / IN-HOUSE MATCH, no dye house name' : ''}${c.active ? '' : ' (INACTIVE)'} [${c.id}]`)
      }
    }
    if (p.bomLines.length) {
      L.push('per unit:')
      for (const b of p.bomLines) {
        const q = Number(b.qtyPerUnit)
        L.push(`  - ${b.component.name}: ${q === 0 ? 'UNKNOWN' : q} ${b.component.unitOfMeasure}`)
      }
    }
    if (p.variants.length) {
      L.push('variants (on hand / sold last 8 weeks):')
      for (const v of p.variants) {
        const name = [v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'default'
        const oh = v.onHandQty === null ? 'UNKNOWN' : String(v.onHandQty)
        L.push(`  - ${name}: ${oh} on hand, ${sold.get(v.id) ?? 0} sold [${v.id}]`)
      }
    }
  }

  L.push('\n## Components')
  L.push('Fabric is bought per production run and shipped straight to the manufacturer.')
  L.push('It is never stocked or counted, so it has no on-hand figure by design.')
  for (const c of components) {
    const stock = c.stockedInStudio ? `${c.onHandQty} in studio` : 'not stocked — bought per run'
    L.push(`- ${c.name} [${c.id}] · ${c.category} · ${c.vendor?.name ?? 'no vendor'}${c.vendorSku ? ` · style ${c.vendorSku}` : ''} · ${money(c.unitCostCents)}/${c.unitOfMeasure} · lead time ${c.leadTimeDays === null ? 'UNKNOWN' : c.leadTimeDays + 'd'} · ${stock}${Number(c.incomingQty) > 0 ? `, ${c.incomingQty} incoming` : ''}`)
  }

  L.push('\n## Vendors')
  for (const v of vendors) {
    L.push(`- ${v.name}${v.legalName ? ` (${v.legalName})` : ''} [${v.id}] · ${v.role}${v.active ? '' : ' · INACTIVE, replaced'}${v.contactName ? ` · ${v.contactName}` : ''}${v.orderMethod ? ` · order by ${v.orderMethod}` : ''}`)
  }

  // Without this it cannot see its own production runs, and creates a fresh
  // one every time it is told about the same job.
  L.push('\n## Production runs in flight')
  if (!runs.length) {
    L.push('(none)')
  } else {
    for (const r of runs) {
      L.push(
        `- ${r.product.name} [${r.id}] at ${r.vendor?.name ?? 'no maker set'} · ${r.status}` +
          (r.cutRef ? ` · ${r.cutRef}` : '') +
          ` · expected ${r.expectedReadyAt ? r.expectedReadyAt.toISOString().slice(0, 10) : 'UNKNOWN'}` +
          (r.dateConfirmed ? '' : ' (not confirmed)') +
          (r.notes ? ` · ${r.notes}` : ''),
      )
    }
    L.push('Before creating a run, check this list. If one already exists for the')
    L.push('same product and job, UPDATE it rather than adding another.')
  }

  if (pos.length) {
    L.push('\n## Open purchase orders')
    for (const p of pos) {
      const lines = p.lines.map((l) => `${l.qtyOrdered} ${l.unit} ${l.component.name}`).join(', ')
      L.push(`- PO ${p.poNumber} to ${p.vendor.name}: ${lines} · ${p.status}`)
    }
  }

  L.push('\n## Open questions and todos')
  L.push('These are things you already know you do not know. Do not re-ask them')
  L.push('unless the conversation touches them; if the user answers one, resolve it.')
  for (const i of items) {
    L.push(`- [${i.id}] ${i.kind}: ${i.title}`)
  }

  return L.join('\n')
}
