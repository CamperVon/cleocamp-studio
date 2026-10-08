import { db } from '@/lib/db'

/**
 * The partner reference (8 Oct 2026): what our style numbers mean, for the
 * patternmakers and factories who will put them on markers, tech packs,
 * invoices and packing lists. Partner-facing, so it carries confirmed styles
 * and codes only: no proposed or retired style, no proposed code, and nothing
 * internal (no costs, stock, notes or people).
 */

export type RefStyle = { number: string; name: string; status: string; photo: string | null; colours: Array<{ code: string; name: string }>; sizes: Array<{ code: string; name: string }> }
export type RefCategory = { code: string; name: string; styles: RefStyle[] }
export type RefCode = { code: string; name: string }

export async function partnerReference(): Promise<{ categories: RefCategory[]; example: string | null; categoryCodes: RefCode[]; sizeCodes: RefCode[] }> {
  const [styles, codes] = await Promise.all([
    db.style.findMany({
      where: { status: { notIn: ['PROPOSED', 'RETIRED'] } },
      orderBy: { number: 'asc' },
      select: { number: true, name: true, status: true, categoryCode: true, products: { select: { status: true, variants: { select: { newSku: true, colorCode: true, sizeCode: true, imageUrl: true } } } } },
    }),
    db.styleCode.findMany({ where: { status: 'CONFIRMED' }, select: { type: true, code: true, name: true } }),
  ])
  const name = (type: string, code: string) => codes.find((c) => c.type === type && c.code === code)?.name ?? null
  const SIZE_ORDER = ['00', '01', '02', '03', 'XS', 'SM', 'MD', 'LG', 'XL', 'PT', 'OS']
  const cats = new Map<string, RefCategory>()
  const allSkus: string[] = []
  for (const s of styles) {
    const catName = name('CATEGORY', s.categoryCode)
    if (!catName) continue // a proposed category stays off the reference
    // Only codes some variant actually carries in a confirmed SKU.
    const vs = s.products.flatMap((p) => p.variants).filter((v) => v.newSku)
    // A photo from Shopify: the selling product's first, else any.
    const photo = [...s.products].sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')).flatMap((p) => p.variants).find((v) => v.imageUrl)?.imageUrl ?? null
    const colours = [...new Set(vs.map((v) => v.colorCode!).filter(Boolean))].sort().map((c) => ({ code: c, name: name('COLOR', c) ?? c }))
    const sizes = [...new Set(vs.map((v) => v.sizeCode!).filter(Boolean))].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b)).map((c) => ({ code: c, name: name('SIZE', c) ?? c }))
    allSkus.push(...vs.map((v) => v.newSku!))
    const cat = cats.get(s.categoryCode) ?? { code: s.categoryCode, name: catName, styles: [] }
    cat.styles.push({ number: s.number, name: s.name, status: s.status, photo, colours, sizes })
    cats.set(s.categoryCode, cat)
  }
  const order = ['TP', 'DR', 'BT', 'BG', 'AC', 'IN', 'PT', 'OT']
  // The worked example is the one everybody knows, when it exists.
  const example = allSkus.includes('TP101-BLK-01') ? 'TP101-BLK-01' : allSkus.sort()[0] ?? null
  const categoryCodes = order.map((c) => ({ code: c, name: name('CATEGORY', c) })).filter((c): c is RefCode => !!c.name)
  const sizeCodes = SIZE_ORDER.map((c) => ({ code: c, name: name('SIZE', c) })).filter((c): c is RefCode => !!c.name)
  return { categories: [...cats.values()].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code)), example, categoryCodes, sizeCodes }
}

/** How to read a SKU, in plain words, built from a real one. Pure. */
export function howToRead(example: string | null): string[] {
  const sku = example ?? 'TP101-BLK-01'
  const [style, colour, size] = sku.split('-')
  return [
    `A SKU has three parts: style, colour and size. ${sku} is style ${style}, colour ${colour}, size ${size}.`,
    'The style number is the pattern. Two letters for the category, then three digits. A new colour or size keeps the same style number; a new pattern gets a new one.',
    'The colour is a three-letter code and the size a two-character code, both from the lists below. Season and year are never part of the code.',
    'A number is never reused, even when a style is retired.',
    'Please put the style number, and the SKU where there is one, on invoices, packing lists, markers, tech packs and sample tags.',
  ]
}
