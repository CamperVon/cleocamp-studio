/**
 * A component's counting unit changed after stock is on file (16 Oct 2026).
 *
 * Leather is counted in square feet (Brandon, 7 Oct 2026): United Leather
 * prices by the square foot and hides vary. Two leathers were still counted
 * in skins, and update_component refused the change once anything was
 * recorded, rightly, since 4 skins would silently read as 4 sq ft. So Mouse
 * could not put Lorena's 10.36 sq ft a Black Cleo Bag on the recipe, and on
 * 15 Oct it logged an invoice's 105 sq ft as 105 skins and had to correct it.
 *
 * Now the change can go through when a person gives how many new units one
 * old unit was, and where that figure comes from. Everything recorded in the
 * old unit is restated in the same transaction: a COUNTED entry at each
 * place (the ledger still sums to the stock), every recipe amount, the price
 * and the reorder level. A purchase unit that only repeated the old counting
 * unit follows it. Nothing else reads the old unit: PO lines carry their own.
 */
import { db } from '@/lib/db'
import { sameUnit } from '@/lib/po-units'
import { currentActor } from '@/lib/mouse/actor'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const r4 = (n: number) => Math.round(n * 10000) / 10000

export type ConvertInput = {
  from: string
  to: string
  perOldUnit: number
  basis: string
  places: Array<{ id: string; qty: number; name: string }>
  recipes: Array<{ id: string; qty: number; label: string }>
  unitCostCents: number | null
  reorderThreshold: number | null
  purchaseUnit: string | null
  /** PO lines still owed in the old unit: refused, so a receipt cannot mismatch them. */
  openPoLines: string[]
}

export type ConvertPlan = {
  places: Array<{ id: string; name: string; was: number; now: number }>
  recipes: Array<{ id: string; label: string; was: number; now: number }>
  unitCostCents: number | null
  reorderThreshold: number | null
  purchaseUnit: string | null | undefined
}

/** The restatement, or why it cannot be made. Pure. */
export function planUnitConversion(c: ConvertInput): { error: string } | ConvertPlan {
  const f = Number(c.perOldUnit)
  if (!(f > 0) || !Number.isFinite(f)) return { error: `Give how many ${c.to} one ${c.from} was, above zero.` }
  if (!c.basis.trim()) return { error: `Say where ${f} ${c.to} per ${c.from} comes from (an invoice, a count), so the restated stock can be traced.` }
  if (c.openPoLines.length) return { error: `Still owed in ${c.from}s on ${c.openPoLines.join(', ')}. Change the unit once that is received, or the receipt would not match.` }
  return {
    places: c.places.map((p) => ({ id: p.id, name: p.name, was: p.qty, now: r3(p.qty * f) })),
    recipes: c.recipes.map((b) => ({ id: b.id, label: b.label, was: b.qty, now: r4(b.qty * f) })),
    unitCostCents: c.unitCostCents === null ? null : Math.round(c.unitCostCents / f),
    reorderThreshold: c.reorderThreshold === null ? null : r3(c.reorderThreshold * f),
    purchaseUnit: c.purchaseUnit && sameUnit(c.purchaseUnit.trim().toLowerCase().split(/[\s(,]/)[0], c.from) ? c.to : undefined,
  }
}

/** Change the unit and restate everything recorded in the old one, all or nothing. */
export async function convertComponentUnit(id: string, to: string, perOldUnit: number, basis: string) {
  const c = await db.component.findUnique({
    where: { id },
    select: {
      name: true, unitOfMeasure: true, unitCostCents: true, reorderThreshold: true, purchaseUnit: true,
      locationStock: { select: { id: true, qty: true, locationId: true, atVendorId: true, location: { select: { name: true } }, atVendor: { select: { name: true } } } },
      usedIn: { select: { id: true, qtyPerUnit: true, size: true, colorway: true, parentProduct: { select: { name: true } }, parentComponent: { select: { name: true } } } },
      poLines: { select: { qtyOrdered: true, qtyReceived: true, purchaseOrder: { select: { poNumber: true, status: true } } } },
    },
  })
  if (!c) return { error: `No component ${id}` }
  const from = c.unitOfMeasure
  const plan = planUnitConversion({
    from, to, perOldUnit, basis,
    places: c.locationStock.map((s) => ({ id: s.id, qty: Number(s.qty), name: s.location?.name ?? s.atVendor?.name ?? 'unknown place' })),
    recipes: c.usedIn.map((b) => ({ id: b.id, qty: Number(b.qtyPerUnit), label: [b.parentProduct?.name ?? b.parentComponent?.name, b.colorway, b.size].filter(Boolean).join(' / ') })),
    unitCostCents: c.unitCostCents,
    reorderThreshold: c.reorderThreshold === null ? null : Number(c.reorderThreshold),
    purchaseUnit: c.purchaseUnit,
    openPoLines: c.poLines
      .filter((l) => !['RECEIVED', 'CANCELLED'].includes(String(l.purchaseOrder.status)) && Number(l.qtyReceived) < Number(l.qtyOrdered))
      .map((l) => `PO ${l.purchaseOrder.poNumber}`),
  })
  if ('error' in plan) return plan
  const note = `Restated from ${from}s to ${to} at ${perOldUnit} ${to} per ${from}: ${basis.trim()}`
  await db.$transaction(async (tx) => {
    for (const p of plan.places) {
      if (p.was === p.now) continue
      const s = c.locationStock.find((x) => x.id === p.id)!
      await tx.inventoryEvent.create({
        data: {
          componentId: id, type: 'COUNTED', deltaQty: String(r3(p.now - p.was)), countedQty: String(p.now),
          source: 'CHAT', note: `${p.was} ${from}${p.was === 1 ? '' : 's'} at ${p.name}. ${note}`, createdById: currentActor(),
          locationId: s.locationId, atVendorId: s.atVendorId,
        },
      })
      await tx.componentLocationStock.update({ where: { id: p.id }, data: { qty: String(p.now) } })
    }
    for (const b of plan.recipes) if (b.was !== b.now) await tx.bomLine.update({ where: { id: b.id }, data: { qtyPerUnit: String(b.now) } })
    const total = plan.places.reduce((n, p) => n + p.now, 0)
    await tx.component.update({
      where: { id },
      data: {
        unitOfMeasure: to, onHandQty: String(r3(total)), unitCostCents: plan.unitCostCents,
        reorderThreshold: plan.reorderThreshold === null ? null : String(plan.reorderThreshold),
        ...(plan.purchaseUnit !== undefined ? { purchaseUnit: plan.purchaseUnit, unitsPerPurchaseUnit: null } : {}),
      },
    })
  })
  return {
    id, name: c.name, from, to,
    stock: plan.places.map((p) => `${p.name}: ${p.was} ${from} → ${p.now} ${to}`),
    recipes: plan.recipes.map((b) => `${b.label}: ${b.was} → ${b.now} ${to}`),
    ...(plan.unitCostCents !== null ? { pricePer: `$${(plan.unitCostCents / 100).toFixed(2)}/${to}` } : {}),
    tellTheUser: `Now counted in ${to}. Say the restated stock and that it rests on ${perOldUnit} ${to} per ${from} (${basis.trim()}); a real count replaces it with log_inventory_event.`,
  }
}
