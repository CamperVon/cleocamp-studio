import { db } from '@/lib/db'

/**
 * What a purchase order's variant line says, frozen when the order is sent.
 *
 * Until 8 Oct 2026 the PO page and the vendor's PDF read a variant line's SKU,
 * product name, colour, size and photo live from the variant. Fine while
 * nothing changed; but the style system (docs/style-system/) gives every
 * variant a new SKU, and a sent order must keep showing exactly what the
 * vendor received: "Purchase orders already sent are not revised." So a line
 * is filled in once, when its order leaves draft, and read from then on.
 * A draft still reads live. A resend never overwrites what was frozen.
 */

export type SkuDisplayMode = 'transition' | 'new'

export const asSkuDisplayMode = (m: string | null | undefined): SkuDisplayMode => (m === 'new' ? 'new' : 'transition')

/**
 * The SKU text for a variant: in transition, the new SKU with the old one in
 * brackets ("TP101-WHT-01 (was CCSS25COT-WHT01)"); in new, the new SKU only.
 * Either way a variant without a new SKU shows its old one. Pure.
 */
export function skuText(v: { sku: string | null; newSku?: string | null }, mode: SkuDisplayMode): string | null {
  if (!v.newSku) return v.sku
  if (mode === 'new' || !v.sku || v.sku === v.newSku) return v.newSku
  return `${v.newSku} (was ${v.sku})`
}

export type LineView = { sku: string | null; product: string; colorway: string | null; size: string | null; imageUrl: string | null }

type LiveVariant = {
  sku: string | null; newSku?: string | null; size: string | null; imageUrl: string | null
  product: { name: string }; colorway: { customerName: string } | null
}

type SnapshotLine = {
  snapshotAt?: Date | null; snapSku?: string | null; snapProductName?: string | null
  snapColorway?: string | null; snapSize?: string | null; snapImageUrl?: string | null
}

/** A variant line as the document shows it: frozen if the order was sent, live if not. Pure. */
export function lineView(l: SnapshotLine & { productVariant: LiveVariant | null }, mode: SkuDisplayMode): LineView | null {
  if (l.snapshotAt) {
    return { sku: l.snapSku ?? null, product: l.snapProductName ?? '', colorway: l.snapColorway ?? null, size: l.snapSize ?? null, imageUrl: l.snapImageUrl ?? null }
  }
  const v = l.productVariant
  if (!v) return null
  return { sku: skuText(v, mode), product: v.product.name, colorway: v.colorway?.customerName ?? null, size: v.size, imageUrl: v.imageUrl }
}

/** The line's label, in the one format both the page and the PDF have always printed. Pure. */
export function lineLabel(view: LineView, styleWord: string): string {
  return `${view.sku ? `${styleWord} ${view.sku} — ` : ''}${view.product}${view.colorway ? ` — ${view.colorway}` : ''}${view.size ? ` / ${view.size}` : ''}`
}

/**
 * Freeze every variant line on this order that is not frozen yet, from what
 * it shows right now. Returns the ids frozen, so a send that then fails can
 * undo exactly those. `legacy` freezes the old SKU alone, the way every
 * document printed it before the style system: the backfill uses it.
 */
export async function freezePoLines(poId: string, opts: { legacy?: boolean } = {}): Promise<string[]> {
  const [lines, defaults] = await Promise.all([
    db.purchaseOrderLine.findMany({
      where: { purchaseOrderId: poId, productVariantId: { not: null }, snapshotAt: null },
      include: { productVariant: { include: { product: { include: { style: true } }, colorway: true } } },
    }),
    db.documentDefaults.findUnique({ where: { id: 'singleton' }, select: { skuDisplayMode: true } }),
  ])
  if (!lines.length) return []
  const mode = asSkuDisplayMode(defaults?.skuDisplayMode)
  const now = new Date()
  await db.$transaction(lines.map((l) => {
    const v = l.productVariant!
    const view = lineView({ productVariant: opts.legacy ? { ...v, newSku: null } : v }, mode)!
    const style = v.product.style && v.product.style.status !== 'PROPOSED' ? v.product.style.number : null
    return db.purchaseOrderLine.update({
      where: { id: l.id },
      data: {
        snapshotAt: now, snapSku: view.sku, snapStyleNumber: opts.legacy ? null : style,
        snapProductName: view.product, snapColorway: view.colorway, snapSize: view.size, snapImageUrl: view.imageUrl,
      },
    })
  }))
  return lines.map((l) => l.id)
}

/** Undo a freeze that did not lead to a send (the email failed, or it was a dry run). */
export async function unfreezePoLines(ids: string[]) {
  if (!ids.length) return
  await db.purchaseOrderLine.updateMany({
    where: { id: { in: ids } },
    data: { snapshotAt: null, snapSku: null, snapStyleNumber: null, snapProductName: null, snapColorway: null, snapSize: null, snapImageUrl: null },
  })
}

/** Forget one line's freeze, for a deliberate revision of that line on a sent order. */
export const unfreezeLine = (id: string) => unfreezePoLines([id])
