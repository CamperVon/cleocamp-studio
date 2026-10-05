import { db } from '@/lib/db'

/**
 * The stylist inventory (Brandon, 5 Oct 2026): pieces kept for stylists, apart
 * from what is for sale. A pull takes from it first. When it is short, the rest
 * may come from sales stock (Shopify) only if a person agreed to that, piece by
 * piece; otherwise nothing is taken and Mouse asks. Returns refill sales stock
 * first, so what was borrowed from the shop goes back to the shop.
 *
 * The count is the sum of StylistStockEvent rows, never a stored number.
 */

export type Piece = { productVariantId: string; qty: number; fromSales?: number }

/** A request's pieces, from its JSON, dropping anything malformed. Pure. */
export function piecesOf(json: unknown): Piece[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((p) => {
    const o = p as Record<string, unknown>
    const qty = Math.round(Number(o?.qty))
    if (typeof o?.productVariantId !== 'string' || !(qty > 0)) return []
    const fromSales = Math.max(0, Math.round(Number(o.fromSales ?? 0)) || 0)
    return [{ productVariantId: o.productVariantId, qty, ...(fromSales ? { fromSales } : {}) }]
  })
}

/**
 * Where `qty` pieces would come from: the stylist inventory first, then sales
 * stock up to what a person agreed. `short` is what neither covers. Pure.
 */
export function splitPull(qty: number, inStylist: number, agreedFromSales = 0) {
  const fromStylist = Math.min(qty, Math.max(0, inStylist))
  const need = qty - fromStylist
  const fromSales = Math.min(need, Math.max(0, agreedFromSales))
  return { fromStylist, fromSales, short: need - fromSales }
}

/**
 * Where `back` returned pieces go, for a line that took `fromStylistQty` of
 * its `qty` from the stylist inventory and has had `returnedQty` back so far.
 * Sales stock is refilled first. Pure.
 */
export function returnSplit(line: { qty: number; fromStylistQty: number; returnedQty: number }, back: number) {
  const salesTaken = line.qty - line.fromStylistQty
  const salesBackSoFar = Math.min(line.returnedQty, salesTaken)
  const toSales = Math.min(back, salesTaken - salesBackSoFar)
  return { toSales, toStylist: back - toSales }
}

/** The stylist inventory now, per variant. Only variants with a count are in the map. */
export async function stylistStock(variantIds?: string[]): Promise<Map<string, number>> {
  const rows = await db.stylistStockEvent.groupBy({
    by: ['productVariantId'],
    ...(variantIds ? { where: { productVariantId: { in: variantIds } } } : {}),
    _sum: { delta: true },
  })
  return new Map(rows.filter((r) => (r._sum.delta ?? 0) !== 0).map((r) => [r.productVariantId, r._sum.delta ?? 0]))
}

export type PieceStatus = { label: string; qty: number; inStylist: number; inSales: number | null; fromStylist: number; fromSales: number; short: number }

/** What each piece of a request would take, and from where, for the pink note and for Mouse. Pure. */
export function pieceStatus(
  pieces: Piece[],
  inStylist: Map<string, number>,
  variants: Map<string, { label: string; onHand: number | null }>,
): PieceStatus[] {
  return pieces.map((p) => {
    const v = variants.get(p.productVariantId)
    const have = inStylist.get(p.productVariantId) ?? 0
    const s = splitPull(p.qty, have, p.fromSales)
    return { label: v?.label ?? p.productVariantId, qty: p.qty, inStylist: have, inSales: v?.onHand ?? null, ...s }
  })
}

/** One plain sentence per piece, as the pink note reads. Pure. */
export function pieceLine(s: PieceStatus): string {
  const sales = s.inSales == null ? 'sales stock not known' : `${s.inSales} in sales stock`
  const head = `${s.qty} × ${s.label}: ${s.inStylist} in stylist inventory, ${sales}.`
  if (!s.short && !s.fromSales) return `${head} All from stylist inventory.`
  if (!s.short) return `${head} ${s.fromStylist ? `${s.fromStylist} from stylist inventory, ` : ''}${s.fromSales} from sales stock, as agreed.`
  return `${head} Short ${s.short}${s.fromSales ? ` after ${s.fromSales} agreed from sales` : ''}. Take ${s.short === 1 ? 'it' : 'them'} from sales stock?`
}

/** "Cleo Tee, Black, Size 1", as a person reads a piece (Brandon, 5 Oct 2026). Pure. */
export function pieceName(product: string, colour?: string | null, size?: string | null): string {
  return [product, colour, size ? `Size ${size}` : null].filter(Boolean).join(', ')
}

/**
 * The short stock note after a piece on the page, in pink. Pure.
 * Covered by the stylist inventory, agreed from sales, short with sales able
 * to cover it, or out of stock everywhere.
 */
export function stockNote(s: PieceStatus): string {
  if (!s.short && !s.fromSales) return 'in stylist inventory'
  if (!s.short) return s.fromStylist ? `${s.fromStylist} from stylist inventory, ${s.fromSales} from sales stock` : 'from sales stock'
  if (s.inSales != null && s.inSales <= 0) return s.inStylist ? `only ${s.inStylist} in stylist inventory, out of stock in sales` : 'out of stock'
  return `${s.inStylist ? `only ${s.inStylist}` : 'none'} in stylist inventory · ${s.inSales == null ? 'sales stock not known' : `${s.inSales} in sales stock`}`
}

/** Labels and Shopify on-hand for some variants, as the page and Mouse show them. */
export async function variantLabels(ids: string[]): Promise<Map<string, { label: string; onHand: number | null }>> {
  if (!ids.length) return new Map()
  const vs = await db.productVariant.findMany({
    where: { id: { in: ids } },
    select: { id: true, size: true, onHandQty: true, product: { select: { name: true } }, colorway: { select: { customerName: true } } },
  })
  return new Map(vs.map((v) => [v.id, {
    label: pieceName(v.product.name, v.colorway?.customerName, v.size),
    onHand: v.onHandQty == null ? null : Number(v.onHandQty),
  }]))
}
