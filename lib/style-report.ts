import { db } from '@/lib/db'
import { SKU_RE } from '@/lib/style-system'

/**
 * The style system's loose ends, for the Daily Cheese, Mouse's context and
 * the snapshot (8 Oct 2026). Short on purpose: nothing wrong reads as one
 * line, and each kind of problem is one line with its count and a few names.
 */

export type ReportInput = {
  products: Array<{ name: string; status: string; style: { number: string; status: string } | null }>
  variants: Array<{ label: string; styleNumber: string | null; styleStatus: string | null; newSku: string | null; colorCode: string | null; sizeCode: string | null; shopifySku: string | null; linkedToShopify: boolean }>
  poLines: Array<{ poNumber: string; label: string; styleNumber: string | null }>
  proposed: { styles: string[]; codes: string[] }
}

const few = (xs: string[], n = 4) => xs.slice(0, n).join(', ') + (xs.length > n ? `, and ${xs.length - n} more` : '')

/** The report's lines; ["Style system: nothing outstanding."] when there is nothing. Pure. */
export function styleReportLines(r: ReportInput): string[] {
  const out: string[] = []
  const live = r.products.filter((p) => p.status !== 'SUNSETTED')
  const noStyle = live.filter((p) => !p.style).map((p) => p.name)
  if (noStyle.length) out.push(`${noStyle.length} product${noStyle.length === 1 ? ' has' : 's have'} no style number: ${few(noStyle)}.`)

  const settled = r.variants.filter((v) => v.styleNumber && v.styleStatus !== 'PROPOSED')
  const noCodes = settled.filter((v) => !v.colorCode || !v.sizeCode).map((v) => v.label)
  if (noCodes.length) out.push(`${noCodes.length} variant${noCodes.length === 1 ? ' is' : 's are'} missing a colour or size code: ${few(noCodes)}.`)
  const noSku = settled.filter((v) => v.colorCode && v.sizeCode && !v.newSku).map((v) => v.label)
  if (noSku.length) out.push(`${noSku.length} variant${noSku.length === 1 ? ' has' : 's have'} codes but no new SKU yet (a code still to confirm): ${few(noSku)}.`)

  const badOurs = r.variants.filter((v) => v.newSku && (!SKU_RE.test(v.newSku) || (v.styleNumber && v.colorCode && v.sizeCode && v.newSku !== `${v.styleNumber}-${v.colorCode}-${v.sizeCode}`)))
  if (badOurs.length) out.push(`${badOurs.length} SKU${badOurs.length === 1 ? '' : 's'} in the app do not match the format or their style, colour and size: ${few(badOurs.map((v) => `${v.label} ${v.newSku}`))}.`)

  // Shopify keeps the old SKUs until the cutover; that is expected, so it is
  // a count. A Shopify SKU in the new format that differs from ours is not.
  const shop = r.variants.filter((v) => v.linkedToShopify)
  const oldInShopify = shop.filter((v) => v.shopifySku && !SKU_RE.test(v.shopifySku)).length
  const blankInShopify = shop.filter((v) => !v.shopifySku).length
  const wrongInShopify = shop.filter((v) => v.shopifySku && SKU_RE.test(v.shopifySku) && v.shopifySku !== v.newSku)
  if (wrongInShopify.length) out.push(`${wrongInShopify.length} Shopify SKU${wrongInShopify.length === 1 ? '' : 's'} in the new format differ from the app's: ${few(wrongInShopify.map((v) => `${v.label} Shopify ${v.shopifySku}, app ${v.newSku ?? 'none'}`))}.`)
  if (shop.length && blankInShopify === shop.length) out.push("Shopify's own SKUs have not been read yet; the next nightly sync brings them in.")
  else if (oldInShopify || blankInShopify) out.push(`Shopify still has ${oldInShopify} old-format SKU${oldInShopify === 1 ? '' : 's'}${blankInShopify ? ` and ${blankInShopify} blank` : ''} (expected until the Shopify switch).`)

  const noStylePo = r.poLines.filter((l) => !l.styleNumber)
  if (noStylePo.length) out.push(`${noStylePo.length} line${noStylePo.length === 1 ? '' : 's'} on open purchase orders ${noStylePo.length === 1 ? 'is' : 'are'} for a product with no confirmed style: ${few(noStylePo.map((l) => `PO ${l.poNumber} ${l.label}`))}.`)

  if (r.proposed.styles.length || r.proposed.codes.length) {
    out.push(`Waiting on Brandon or Cleo: ${[r.proposed.styles.length ? `${r.proposed.styles.length} proposed style${r.proposed.styles.length === 1 ? '' : 's'} (${few(r.proposed.styles, 7)})` : '', r.proposed.codes.length ? `${r.proposed.codes.length} proposed code${r.proposed.codes.length === 1 ? '' : 's'} (${few(r.proposed.codes, 6)})` : ''].filter(Boolean).join(' and ')}.`)
  }
  return out.length ? out : ['Style system: nothing outstanding.']
}

/** The report from the database. */
export async function styleReport(): Promise<string[]> {
  const [products, variants, poLines, styles, codes] = await Promise.all([
    db.product.findMany({ select: { name: true, status: true, style: { select: { number: true, status: true } } }, orderBy: { name: 'asc' } }),
    db.productVariant.findMany({
      where: { product: { status: { not: 'SUNSETTED' } } },
      select: { size: true, newSku: true, colorCode: true, sizeCode: true, shopifySku: true, shopifyVariantId: true, colorway: { select: { customerName: true } }, product: { select: { name: true, style: { select: { number: true, status: true } } } } },
    }),
    db.purchaseOrderLine.findMany({
      where: { productVariantId: { not: null }, purchaseOrder: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } } },
      select: { purchaseOrder: { select: { poNumber: true } }, productVariant: { select: { size: true, colorway: { select: { customerName: true } }, product: { select: { name: true, style: { select: { number: true, status: true } } } } } } },
    }),
    db.style.findMany({ where: { status: 'PROPOSED' }, select: { number: true, name: true }, orderBy: { number: 'asc' } }),
    db.styleCode.findMany({ where: { status: 'PROPOSED' }, select: { type: true, code: true }, orderBy: { code: 'asc' } }),
  ])
  const label = (p: { name: string }, c: { customerName: string } | null, size: string | null) => [p.name, c?.customerName, size].filter(Boolean).join(' / ')
  const confirmed = (s: { number: string; status: string } | null) => (s && s.status !== 'PROPOSED' ? s.number : null)
  return styleReportLines({
    products: products.map((p) => ({ name: p.name, status: p.status, style: p.style })),
    variants: variants.map((v) => ({
      label: label(v.product, v.colorway, v.size), styleNumber: v.product.style?.number ?? null, styleStatus: v.product.style?.status ?? null,
      newSku: v.newSku, colorCode: v.colorCode, sizeCode: v.sizeCode, shopifySku: v.shopifySku, linkedToShopify: !!v.shopifyVariantId,
    })),
    poLines: poLines.map((l) => ({
      poNumber: l.purchaseOrder.poNumber,
      label: label(l.productVariant!.product, l.productVariant!.colorway, l.productVariant!.size),
      styleNumber: confirmed(l.productVariant!.product.style),
    })),
    proposed: { styles: styles.map((s) => `${s.number} ${s.name}`), codes: codes.map((c) => `${c.type.toLowerCase()} ${c.code}`) },
  })
}
