import { db as defaultDb } from '@/lib/db'
import { resolvePattern, type PatternLite } from '@/lib/patterns'

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
 * brackets ("TCO101-WHT-01 (was CCSS25COT-WHT01)"); in new, the new SKU only.
 * Either way a variant without a new SKU shows its old one. Pure.
 */
export function skuText(v: { sku: string | null; newSku?: string | null }, mode: SkuDisplayMode): string | null {
  if (!v.newSku) return v.sku
  if (mode === 'new' || !v.sku || v.sku === v.newSku) return v.newSku
  return `${v.newSku} (was ${v.sku})`
}

/**
 * `pattern` is the pattern code the line is cut from ("TCO101-P2"), printed
 * on its own line under the label, never inside it: a line sent before
 * patterns existed prints exactly as it did. `patternToPick` is set on a
 * draft whose style has two or more patterns in use and none picked yet.
 */
export type LineView = {
  sku: string | null; product: string; colorway: string | null; size: string | null; imageUrl: string | null
  pattern?: string | null; patternToPick?: string | null
}

type LiveVariant = {
  sku: string | null; newSku?: string | null; size: string | null; imageUrl: string | null
  product: { name: string; style?: { number: string; patterns?: PatternLite[] } | null }; colorway: { customerName: string } | null
}

type SnapshotLine = {
  snapshotAt?: Date | null; snapSku?: string | null; snapProductName?: string | null
  snapColorway?: string | null; snapSize?: string | null; snapImageUrl?: string | null; snapPattern?: string | null
  pattern?: PatternLite | null
}

/**
 * A variant line as the document shows it: frozen if the order was sent, live
 * if not. `cutAndSew` is whether the order is with a maker (vendor role
 * MANUFACTURER): only there does a style's one pattern become the line's
 * default. Pure.
 */
export function lineView(l: SnapshotLine & { productVariant: LiveVariant | null }, mode: SkuDisplayMode, opts: { cutAndSew?: boolean } = {}): LineView | null {
  if (l.snapshotAt) {
    return { sku: l.snapSku ?? null, product: l.snapProductName ?? '', colorway: l.snapColorway ?? null, size: l.snapSize ?? null, imageUrl: l.snapImageUrl ?? null, pattern: l.snapPattern ?? null }
  }
  const v = l.productVariant
  if (!v) return null
  const style = v.product.style ? { number: v.product.style.number, patterns: v.product.style.patterns ?? [] } : null
  const p = resolvePattern(l, style, !!opts.cutAndSew)
  return { sku: skuText(v, mode), product: v.product.name, colorway: v.colorway?.customerName ?? null, size: v.size, imageUrl: v.imageUrl, pattern: p.code, patternToPick: p.problem }
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
export async function freezePoLines(poId: string, opts: { legacy?: boolean; client?: typeof defaultDb } = {}): Promise<string[]> {
  const db = opts.client ?? defaultDb
  const [lines, defaults, po] = await Promise.all([
    db.purchaseOrderLine.findMany({
      where: { purchaseOrderId: poId, productVariantId: { not: null }, snapshotAt: null },
      include: { pattern: true, productVariant: { include: { product: { include: { style: { include: { patterns: true } } } }, colorway: true } } },
    }),
    db.documentDefaults.findUnique({ where: { id: 'singleton' }, select: { skuDisplayMode: true } }),
    db.purchaseOrder.findUnique({ where: { id: poId }, select: { vendor: { select: { role: true } } } }),
  ])
  if (!lines.length) return []
  // The photo it is sent with includes one the app holds for a colour not on Shopify.
  await (await import('@/lib/variant-photos')).fillPhotos(db, lines)
  const mode = asSkuDisplayMode(defaults?.skuDisplayMode)
  const now = new Date()
  await db.$transaction(lines.map((l) => {
    const v = l.productVariant!
    const view = lineView({ pattern: l.pattern, productVariant: opts.legacy ? { ...v, newSku: null } : v }, mode, { cutAndSew: po?.vendor.role === 'MANUFACTURER' })!
    const style = v.product.style && v.product.style.status !== 'PROPOSED' ? v.product.style.number : null
    return db.purchaseOrderLine.update({
      where: { id: l.id },
      data: {
        snapshotAt: now, snapSku: view.sku, snapStyleNumber: opts.legacy ? null : style,
        snapProductName: view.product, snapColorway: view.colorway, snapSize: view.size, snapImageUrl: view.imageUrl,
        // The pattern is saved with the SKU. A line that still needs one
        // picked is stopped before this by patternGate (lib/po-patterns.ts).
        snapPattern: opts.legacy ? null : (view.pattern ?? null),
      },
    })
  }))
  return lines.map((l) => l.id)
}

/** Undo a freeze that did not lead to a send (the email failed, or it was a dry run). */
export async function unfreezePoLines(ids: string[]) {
  if (!ids.length) return
  await defaultDb.purchaseOrderLine.updateMany({
    where: { id: { in: ids } },
    data: { snapshotAt: null, snapSku: null, snapStyleNumber: null, snapProductName: null, snapColorway: null, snapSize: null, snapImageUrl: null, snapPattern: null },
  })
}

/** Forget one line's freeze, for a deliberate revision of that line on a sent order. */
export const unfreezeLine = (id: string) => unfreezePoLines([id])
