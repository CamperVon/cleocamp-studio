import { db } from '@/lib/db'

/**
 * Close a purchase order: nothing more is coming on it. Brandon, 1 Oct 2026:
 * "Close 2371. Starting anew with mouse and Lorena", where 10 Black Petite
 * Bean Bags were ordered and 3 arrived. Mouse could set a status but had no
 * way to say "and the rest is not coming", so the 7 sat on the line as owed.
 *
 * The lines are left as they are, so what was ordered and what came stays on
 * record (the ledger never lies about a delivery). The order becomes RECEIVED
 * if anything came, CANCELLED if nothing did; every count of what is still
 * owed (the forecast, reorder_math, Mouse's context) reads only open orders,
 * so the shortfall stops counting. What never came is written down as an
 * internal note on the order, never in the notes printed for the vendor.
 */
export type CloseResult =
  | { ok: true; poNumber: string; status: 'RECEIVED' | 'CANCELLED'; shortLines: string[] }
  | { ok: false; error: string }

/** What each line still owed when closed, in words. Pure. */
export function shortfall(lines: Array<{ label: string; ordered: number; received: number; unit: string }>): string[] {
  return lines.filter((l) => l.received < l.ordered).map((l) => `${l.label}: ${l.received} of ${l.ordered} ${l.unit} came, ${l.ordered - l.received} never will`)
}

export async function closePurchaseOrder(poNumber: string, reason: string): Promise<CloseResult> {
  const po = await db.purchaseOrder.findFirst({
    where: { poNumber },
    include: { lines: { include: { component: { select: { name: true } }, productVariant: { select: { size: true, product: { select: { name: true } }, colorway: { select: { customerName: true } } } } } } },
  })
  if (!po) return { ok: false, error: `No purchase order ${poNumber}.` }
  if (po.status === 'DRAFT') return { ok: false, error: `PO ${poNumber} is still a draft, never sent. Cancel it instead (status CANCELLED).` }
  const lines = po.lines.map((l) => ({
    label: l.productVariant ? [l.productVariant.product.name, l.productVariant.colorway?.customerName, l.productVariant.size].filter(Boolean).join(' / ') : (l.component?.name ?? l.description ?? 'line'),
    ordered: Number(l.qtyOrdered), received: Number(l.qtyReceived), unit: l.unit,
  }))
  const anyCame = lines.some((l) => l.received > 0) || !!po.receivedAt
  const status = anyCame ? 'RECEIVED' as const : 'CANCELLED' as const
  const short = shortfall(lines)
  await db.$transaction([
    db.purchaseOrder.update({ where: { id: po.id }, data: { status } }),
    db.note.create({
      data: {
        entityType: 'PURCHASE_ORDER', entityId: po.id, source: 'CHAT',
        content: `PO ${poNumber} closed ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' })}: ${reason.trim() || 'nothing more is coming'}.${short.length ? ` Not delivered and no longer owed: ${short.join('; ')}.` : ''}`,
      },
    }),
  ])
  return { ok: true, poNumber, status, shortLines: short }
}
