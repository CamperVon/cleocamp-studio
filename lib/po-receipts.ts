/**
 * Goods arriving against a purchase order, ticked off on its lines.
 *
 * Until 29 Sept 2026 nothing did this. A delivery was logged as stock, the
 * PO line kept saying 0 received, and so the PO said everything was still
 * owed. Brandon asked what Staples still owed on PO 2362; 20 skirts had been
 * logged in on 25 Sept, and Mouse answered "all 101". "Major screw up. We
 * told mouse exactly how many skirts had come in." The forecast reads the
 * same lines for what is still on order, so it was counting delivered goods
 * as coming as well.
 */
import { db } from '@/lib/db'
import { unitsPerLineUnit } from '@/lib/po-units'

// Lines carry their component so a line ordered by the roll can be read in
// the single stickers the stock counts (lib/po-units.ts). Quantities passed
// in and reported out are always in the item's own counting unit.
const WITH_UNIT = { orderBy: { id: 'asc' as const }, include: { component: { select: { unitOfMeasure: true, purchaseUnit: true, unitsPerPurchaseUnit: true } } } }

/** "PO 2362", "PO #2362", "po2362" in a note → "2362". Pure. */
export function poNumberIn(text: string | null | undefined): string | null {
  const m = (text ?? '').match(/\bPO\s*#?\s*(\d{4,5})\b/i)
  return m ? m[1] : null
}

/**
 * Put `qty` received against the PO's line(s) for this item: fills each
 * matching line up to what was ordered, and any extra lands on the last one
 * (a vendor sending more than ordered is recorded as it happened, not
 * trimmed). The PO's status follows: some in → PARTIALLY_RECEIVED, all in →
 * RECEIVED. Never moves a DRAFT or CANCELLED order.
 */
export async function receiveOnPo(
  poNumber: string,
  item: { productVariantId?: string | null; componentId?: string | null },
  qty: number,
): Promise<{ ok: boolean; message: string }> {
  const po = await db.purchaseOrder.findFirst({ where: { poNumber }, include: { lines: WITH_UNIT } })
  if (!po) return { ok: false, message: `PO ${poNumber} is not on file, so nothing was ticked off on a PO.` }
  if (po.status === 'DRAFT' || po.status === 'CANCELLED') return { ok: false, message: `PO ${poNumber} is ${po.status.toLowerCase()}, so nothing was ticked off on it.` }
  const lines = po.lines.filter((l) =>
    (item.productVariantId && l.productVariantId === item.productVariantId) || (item.componentId && l.componentId === item.componentId))
  if (!lines.length) return { ok: false, message: `This item is not a line on PO ${poNumber}, so nothing was ticked off on it. Say so.` }

  let left = qty
  const updates: Array<{ id: string; received: number }> = []
  for (const [k, l] of lines.entries()) {
    const f = unitsPerLineUnit(l.unit, l.component)
    const room = Math.max(0, Number(l.qtyOrdered) - Number(l.qtyReceived)) * f
    const take = k === lines.length - 1 ? left : Math.min(left, room)
    if (take > 0) updates.push({ id: l.id, received: Number(l.qtyReceived) + take / f })
    left -= take
    if (left <= 0) break
  }
  const after = po.lines.map((l) => ({ ordered: Number(l.qtyOrdered), received: updates.find((u) => u.id === l.id)?.received ?? Number(l.qtyReceived), f: unitsPerLineUnit(l.unit, l.component) }))
  const all = after.every((l) => l.received >= l.ordered)
  const status = all ? 'RECEIVED' : after.some((l) => l.received > 0) ? 'PARTIALLY_RECEIVED' : po.status
  await db.$transaction([
    ...updates.map((u) => db.purchaseOrderLine.update({ where: { id: u.id }, data: { qtyReceived: String(u.received) } })),
    ...(status !== po.status ? [db.purchaseOrder.update({ where: { id: po.id }, data: { status } })] : []),
  ])
  const owed = owedOf(after.filter((_, k) => lines.some((l) => l.id === po.lines[k].id)))
  return { ok: true, message: `Ticked off ${qty} on PO ${poNumber}; ${owed ? `${owed} of this still owed on the PO` : all ? 'the PO is now fully received' : 'nothing more of this is owed on the PO'}.` }
}

/**
 * Take `qty` back off the PO's line(s) for this item, when a receipt it
 * ticked off turns out never to have happened. Empties the last line first,
 * the reverse of how receiveOnPo fills them. Status follows: nothing left
 * received → SENT, some → PARTIALLY_RECEIVED. On 21 Sept 2026 Brandon said
 * the 18 Sept Lorena pickup had fallen through; Mouse fixed the notes and
 * runs and left the stock and the order saying it had arrived.
 */
export async function unreceiveOnPo(
  poNumber: string,
  item: { productVariantId?: string | null; componentId?: string | null },
  qty: number,
): Promise<{ ok: boolean; message: string }> {
  const po = await db.purchaseOrder.findFirst({ where: { poNumber }, include: { lines: WITH_UNIT } })
  if (!po) return { ok: false, message: `PO ${poNumber} is not on file, so nothing was taken off a PO.` }
  if (po.status === 'DRAFT' || po.status === 'CANCELLED') return { ok: false, message: `PO ${poNumber} is ${po.status.toLowerCase()}, so nothing was taken off it.` }
  const lines = po.lines.filter((l) =>
    (item.productVariantId && l.productVariantId === item.productVariantId) || (item.componentId && l.componentId === item.componentId))
  if (!lines.length) return { ok: false, message: `This item is not a line on PO ${poNumber}, so nothing was taken off it.` }

  let left = qty
  const updates: Array<{ id: string; received: number }> = []
  for (const l of [...lines].reverse()) {
    const f = unitsPerLineUnit(l.unit, l.component)
    const take = Math.min(left, Number(l.qtyReceived) * f)
    if (take > 0) updates.push({ id: l.id, received: Number(l.qtyReceived) - take / f })
    left -= take
    if (left <= 0) break
  }
  if (!updates.length) return { ok: false, message: `PO ${poNumber} had nothing received on this item, so nothing was taken off it.` }
  const after = po.lines.map((l) => ({ ordered: Number(l.qtyOrdered), received: updates.find((u) => u.id === l.id)?.received ?? Number(l.qtyReceived), f: unitsPerLineUnit(l.unit, l.component) }))
  const status = after.every((l) => l.received >= l.ordered) ? 'RECEIVED' : after.some((l) => l.received > 0) ? 'PARTIALLY_RECEIVED' : 'SENT'
  await db.$transaction([
    ...updates.map((u) => db.purchaseOrderLine.update({ where: { id: u.id }, data: { qtyReceived: String(u.received) } })),
    ...(status !== po.status ? [db.purchaseOrder.update({ where: { id: po.id }, data: { status } })] : []),
  ])
  const owed = owedOf(after.filter((_, k) => lines.some((l) => l.id === po.lines[k].id)))
  return { ok: true, message: `Took ${qty - Math.max(0, left)} back off PO ${poNumber}; ${owed} of this now owed on it.` }
}

/**
 * How many of this item the PO still owes, or null when that cannot be said
 * (no such PO, a draft or cancelled one, or the item is not a line on it).
 */
export async function owedOnPo(
  poNumber: string,
  item: { productVariantId?: string | null; componentId?: string | null },
): Promise<number | null> {
  const po = await db.purchaseOrder.findFirst({ where: { poNumber }, include: { lines: WITH_UNIT } })
  if (!po || po.status === 'DRAFT' || po.status === 'CANCELLED') return null
  const lines = po.lines.filter((l) =>
    (item.productVariantId && l.productVariantId === item.productVariantId) || (item.componentId && l.componentId === item.componentId))
  if (!lines.length) return null
  return owedOf(lines.map((l) => ({ ordered: Number(l.qtyOrdered), received: Number(l.qtyReceived), f: unitsPerLineUnit(l.unit, l.component) })))
}

/** What is still owed, in the item's own unit. Pure. */
function owedOf(lines: Array<{ ordered: number; received: number; f: number }>): number {
  return Math.round(lines.reduce((n, l) => n + Math.max(0, l.ordered - l.received) * l.f, 0) * 1000) / 1000
}
