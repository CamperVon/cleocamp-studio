import { db } from '@/lib/db'
import { lineFits } from '@/lib/bom'

/**
 * Trims a maker used, taken off what the maker holds when the finished
 * goods come back (Brandon, 29 Oct 2026: "whenever empire delivers tees back
 * to us, you need to subtract the tags and glassine etc, because they
 * deliver the entire product to us"). Until then labels, hangtags, glassine,
 * buttons and stickers dropped at Antonio's only ever went up: about 2,800
 * finished tees came back and the count still read as if none were used,
 * so nobody could say what was left there. Mouse took the history off by
 * hand that day; this does each delivery from then on.
 *
 * Only what the product's recipe lists, only components the maker actually
 * holds a count of (a hangtag the studio puts on itself is not there to take
 * off), and never fabric: fabric is used at cutting, long before delivery,
 * and its leftover is counted after the cut, so taking it off again on
 * delivery would count it twice.
 */

/** Where a maker's stock is kept when it is a named location rather than the vendor itself. */
export const MAKER_LOCATIONS: Record<string, string> = {
  // Antonio's sews and packs at Empire Sewing; trims dropped there are counted at that location.
  vnd_empire: 'loc_empire',
}

export type RecipeLine = { componentId: string; qtyPerUnit: number; size: string | null; colorway: string | null; category: string }

/** What finished units of this variant used from the maker's stock. Pure. */
export function trimsUsed(
  lines: RecipeLine[],
  variant: { size: string | null; colorway?: { customerName: string } | null },
  qty: number,
  heldThere: Set<string>,
): Array<{ componentId: string; qty: number }> {
  const out = new Map<string, number>()
  for (const l of lines) {
    if (l.category === 'MATERIAL' || !(l.qtyPerUnit > 0) || !heldThere.has(l.componentId) || !lineFits(l, variant)) continue
    out.set(l.componentId, (out.get(l.componentId) ?? 0) + l.qtyPerUnit * qty)
  }
  return [...out].map(([componentId, q]) => ({ componentId, qty: Math.round(q * 1000) / 1000 }))
}

type Write = (args: { componentId: string; deltaQty: number; type: string; note: string; locationId?: string; atVendorId?: string; source?: 'CHAT' | 'SYSTEM' }) => Promise<{ eventId?: unknown; error?: string }>

/**
 * After finished goods are received on a PO: take the trims they used off the
 * maker's stock. Never twice for the same delivery (the receipt's event id is
 * in each note). Returns a line for the person, or null when nothing applied.
 */
export async function takeMakerTrims(poNumber: string, productVariantId: string, qty: number, receiptEventId: string, write: Write): Promise<string | null> {
  const po = await db.purchaseOrder.findFirst({ where: { poNumber }, select: { vendorId: true, vendor: { select: { name: true } } } })
  if (!po?.vendorId) return null
  const locationId = MAKER_LOCATIONS[po.vendorId]
  const place = locationId ? { locationId } : { atVendorId: po.vendorId }
  const marker = `[made-from ${receiptEventId}]`
  if (await db.inventoryEvent.findFirst({ where: { note: { contains: marker } }, select: { id: true } })) return null

  const v = await db.productVariant.findUnique({ where: { id: productVariantId }, select: { productId: true, size: true, colorway: { select: { customerName: true } } } })
  if (!v) return null
  const [bom, held] = await Promise.all([
    db.bomLine.findMany({ where: { parentProductId: v.productId }, select: { componentId: true, qtyPerUnit: true, size: true, colorway: true, component: { select: { category: true } } } }),
    db.componentLocationStock.findMany({ where: place, select: { componentId: true } }),
  ])
  const used = trimsUsed(
    bom.map((b) => ({ componentId: b.componentId, qtyPerUnit: Number(b.qtyPerUnit), size: b.size, colorway: b.colorway, category: String(b.component.category) })),
    v, qty, new Set(held.map((h) => h.componentId)),
  )
  if (!used.length) return null
  const names = await db.component.findMany({ where: { id: { in: used.map((u) => u.componentId) } }, select: { id: true, name: true } })
  const done: string[] = [], failed: string[] = []
  for (const u of used) {
    const name = names.find((n) => n.id === u.componentId)?.name ?? u.componentId
    const w = await write({ componentId: u.componentId, deltaQty: -u.qty, type: 'USED', source: 'SYSTEM', ...place, note: `Used by ${po.vendor?.name ?? 'the maker'} on ${qty} finished, delivered on PO ${poNumber} ${marker}` })
    if (w.eventId) done.push(`${u.qty} ${name}`)
    else failed.push(`${name} (${w.error ?? 'not written'})`)
  }
  return `Took the trims these used off ${po.vendor?.name ?? 'the maker'}'s count: ${done.join(', ') || 'none'}.` + (failed.length ? ` Could not take off: ${failed.join('; ')}.` : '')
}
