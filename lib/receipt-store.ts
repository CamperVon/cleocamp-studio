/**
 * The database side of lib/receipt-gate.ts: what names an item, holding a
 * line, and confirming one. Kept apart so the gate's decisions can be tested
 * on the tool's real path with an in-memory store instead.
 */
import { db } from '@/lib/db'
import { newCode, type ConfirmDeps, type GateDeps, type HeldRow, type ItemTerms, type StockCall, type Turn } from '@/lib/receipt-gate'

async function terms(call: StockCall): Promise<ItemTerms | null> {
  if (call.productVariantId) {
    const v = await db.productVariant.findUnique({
      where: { id: call.productVariantId },
      select: { sku: true, size: true, colorway: { select: { customerName: true } }, product: { select: { id: true, name: true, style: { select: { number: true } }, variants: { select: { size: true, colorway: { select: { customerName: true } } } } } } },
    })
    if (!v) return null
    const others = await db.product.findMany({ where: { id: { not: v.product.id } }, select: { name: true, style: { select: { number: true } } } })
    const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))]
    return {
      kind: 'variant',
      names: uniq([v.product.name, v.product.style?.number, v.sku]),
      rivals: uniq(others.flatMap((o) => [o.name, o.style?.number])),
      colour: { mine: v.colorway?.customerName ?? null, all: uniq(v.product.variants.map((x) => x.colorway?.customerName)) },
      size: { mine: v.size, all: uniq(v.product.variants.map((x) => x.size)) },
    }
  }
  if (call.componentId) {
    const c = await db.component.findUnique({ where: { id: call.componentId }, select: { name: true, vendorSku: true } })
    if (!c) return null
    const others = await db.component.findMany({ where: { active: true, id: { not: call.componentId } }, select: { name: true } })
    return { kind: 'component', names: [c.name, ...(c.vendorSku ? [c.vendorSku] : [])], rivals: others.map((o) => o.name) }
  }
  return null
}

async function hold(call: StockCall, label: string, turn: Turn): Promise<{ id: string; code: string }> {
  // A code no open line already has.
  for (let n = 0; n < 8; n++) {
    const code = newCode()
    const clash = await db.pendingReceipt.findFirst({ where: { code, usedAt: null }, select: { id: true } })
    if (clash) continue
    const r = await db.pendingReceipt.create({
      data: {
        code, turnId: turn.id, personId: turn.personId, type: call.type,
        productVariantId: call.productVariantId, componentId: call.componentId,
        locationId: call.locationId, atVendorId: call.atVendorId,
        deltaQty: String(call.qty), poNumber: call.poNumber, note: call.note, label,
      },
      select: { id: true, code: true },
    })
    return r
  }
  throw new Error('Could not find a free hold code.')
}

export function gateDeps(label: (call: StockCall) => Promise<string>): GateDeps {
  return { terms, label, hold }
}

export function confirmDeps(write: ConfirmDeps['write']): ConfirmDeps {
  return {
    findOpen: async (code) => {
      const r = await db.pendingReceipt.findFirst({ where: { code, usedEventId: null }, orderBy: { createdAt: 'desc' } })
      return r ? ({ ...r, qty: Number(r.deltaQty) } as HeldRow) : null
    },
    claim: async (id) => (await db.pendingReceipt.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } })).count === 1,
    release: async (id) => { await db.pendingReceipt.updateMany({ where: { id, usedEventId: null }, data: { usedAt: null } }) },
    markLogged: async (id, eventId) => { await db.pendingReceipt.update({ where: { id }, data: { usedEventId: eventId } }) },
    write,
    now: () => Date.now(),
  }
}

/** The lines held this turn, for the reply. */
export async function heldThisTurn(turnId: string): Promise<Array<{ label: string; code: string }>> {
  return db.pendingReceipt.findMany({ where: { turnId, usedAt: null }, orderBy: { createdAt: 'asc' }, select: { label: true, code: true } })
}
