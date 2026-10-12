import { db } from '@/lib/db'
import { STYLE_RE, nextStyleNumber, planSkus, sizeCodeFor } from '@/lib/style-system'

/**
 * Giving things style numbers and codes (8 Oct 2026, docs/style-system/).
 * The rules that do not bend: a number is never reused; a code nobody has
 * confirmed is PROPOSED and cannot go into a SKU; only Brandon or Cleo
 * confirm. Every proposal raises a question for them, so nothing is decided
 * by Mouse alone.
 */

/** Who may confirm a style number or a code. */
export const CONFIRMERS = new Set(['per_brandon', 'per_cleo'])

const FORMAT: Record<'CATEGORY' | 'COLOR' | 'SIZE', RegExp> = {
  CATEGORY: /^[A-Z]{2}$/,
  COLOR: /^[A-Z]{3}$/,
  // Only the sizes a SKU can carry (lib/style-system.ts SKU_RE).
  SIZE: /^(\d{2}|XS|SM|MD|LG|XL|PT|OS)$/,
}
type CodeType = keyof typeof FORMAT

async function ask(title: string, detail: string, productId?: string | null) {
  const open = await db.actionItem.findFirst({ where: { title, resolved: false }, select: { id: true } })
  if (open) return open.id
  const r = await db.actionItem.create({
    data: { kind: 'QUESTION', source: 'SYSTEM', title, detail: `For Brandon and Cleo (style system). ${detail}`, ...(productId ? { entityType: 'PRODUCT', entityId: productId } : {}) },
    select: { id: true },
  })
  return r.id
}

/**
 * A code, proposed if it is new. An existing code is returned as it stands,
 * confirmed or not. A code in the wrong shape is refused.
 */
export async function proposeCode(type: CodeType, code: string, name: string): Promise<{ ok: true; code: string; status: 'CONFIRMED' | 'PROPOSED'; questionId?: string } | { ok: false; error: string }> {
  const c = code.trim().toUpperCase()
  if (!FORMAT[type].test(c)) {
    return { ok: false, error: type === 'SIZE'
      ? `"${code}" cannot be a size code: a SKU allows only 00 to 99, XS, SM, MD, LG, XL, PT or OS. A different size needs Brandon to change the SKU format first.`
      : `"${code}" cannot be a ${type === 'COLOR' ? 'colour' : 'category'} code: it must be ${type === 'COLOR' ? 'three' : 'two'} capital letters.` }
  }
  const existing = await db.styleCode.findUnique({ where: { type_code: { type, code: c } } })
  if (existing) return { ok: true, code: c, status: existing.status }
  if (!name.trim()) return { ok: false, error: 'Say what the code stands for.' }
  await db.styleCode.create({ data: { type, code: c, name: name.trim(), status: 'PROPOSED' } })
  const questionId = await ask(`Confirm the new ${type === 'COLOR' ? 'colour' : type.toLowerCase()} code ${c} (${name.trim()})`,
    `${c} was proposed for "${name.trim()}". It cannot be used in a SKU until one of you confirms it.`)
  return { ok: true, code: c, status: 'PROPOSED', questionId }
}

/**
 * A new pattern: the next number in its category (highest ever used plus
 * one, retired and proposed included), created PROPOSED, and the product
 * linked to it. A new category is proposed with it.
 */
export async function proposeStyle(input: { productId: string; categoryCode: string; categoryName?: string }) {
  const product = await db.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true, styleId: true } })
  if (!product) return { ok: false as const, error: `No product ${input.productId}.` }
  if (product.styleId) {
    const s = await db.style.findUnique({ where: { id: product.styleId }, select: { number: true } })
    return { ok: false as const, error: `${product.name} already has style ${s?.number}. A number is never reused or moved; ask Brandon if it is wrong.` }
  }
  const cat = await proposeCode('CATEGORY', input.categoryCode, input.categoryName ?? '')
  if (!cat.ok) return cat
  const all = await db.style.findMany({ select: { number: true } })
  const number = nextStyleNumber(cat.code, all.map((s) => s.number))
  const style = await db.style.create({ data: { number, name: product.name, categoryCode: cat.code, status: 'PROPOSED', sizes: 'TBD', notes: 'Proposed by Studio Mouse; not confirmed.' } })
  await db.product.update({ where: { id: product.id }, data: { styleId: style.id } })
  const questionId = await ask(`Confirm style number ${number} for ${product.name}`,
    `${product.name} was recorded as a new pattern, so it was given the next ${cat.code} number, ${number}. Confirm it, or say if it is really a new colour of an existing style.`, product.id)
  return { ok: true as const, number, status: 'PROPOSED' as const, questionId, categoryStatus: cat.status }
}

/** A new colour or version of an existing style: the product is linked to that style's number. */
export async function linkStyle(productId: string, styleNumber: string) {
  const n = styleNumber.trim().toUpperCase()
  if (!STYLE_RE.test(n)) return { ok: false as const, error: `"${styleNumber}" is not a style number (two letters, three digits: TP101).` }
  const [product, style] = await Promise.all([
    db.product.findUnique({ where: { id: productId }, select: { id: true, name: true, styleId: true } }),
    db.style.findUnique({ where: { number: n } }),
  ])
  if (!product) return { ok: false as const, error: `No product ${productId}.` }
  if (!style) return { ok: false as const, error: `There is no style ${n}. A new pattern gets a new number: propose one instead.` }
  if (product.styleId && product.styleId !== style.id) return { ok: false as const, error: `${product.name} already has a different style. Ask Brandon before moving it.` }
  await db.product.update({ where: { id: product.id }, data: { styleId: style.id } })
  return { ok: true as const, number: n, status: style.status }
}

/** Brandon or Cleo confirm a proposed style or code. Anyone else, or nobody, is refused. */
export async function confirm(what: { styleNumber?: string; codeType?: CodeType; code?: string }, actor: string | null) {
  if (!actor || !CONFIRMERS.has(actor)) return { ok: false as const, error: 'Only Brandon or Cleo can confirm a style number or code, in their own words.' }
  if (what.styleNumber) {
    const n = what.styleNumber.trim().toUpperCase()
    const s = await db.style.findUnique({ where: { number: n } })
    if (!s) return { ok: false as const, error: `No style ${n}.` }
    // Only PROPOSED is unconfirmed. DRAFT, DEVELOPMENT and the rest are where the
    // product stands, not approval: on 12 Oct 2026 "TP102 was already draft"
    // read to Mouse as "still unapproved", and it flagged a failure that wasn't one.
    if (s.status !== 'PROPOSED') return { ok: true as const, confirmed: n, note: `${n} is already confirmed. Its status, ${s.status.toLowerCase().replace('_', ' ')}, is the product's stage, not its approval; only "proposed" means unconfirmed.` }
    await db.style.update({ where: { number: n }, data: { status: 'DEVELOPMENT', notes: `${s.notes ? s.notes + ' ' : ''}Confirmed ${new Date().toISOString().slice(0, 10)}.` } })
    return { ok: true as const, confirmed: n }
  }
  if (what.codeType && what.code) {
    const c = what.code.trim().toUpperCase()
    const r = await db.styleCode.updateMany({ where: { type: what.codeType, code: c }, data: { status: 'CONFIRMED' } })
    if (!r.count) return { ok: false as const, error: `No ${what.codeType.toLowerCase()} code ${c}.` }
    return { ok: true as const, confirmed: c }
  }
  return { ok: false as const, error: 'Say which style number, or which code.' }
}

/**
 * Give a product's variants their new SKUs where every part is settled: the
 * style is not proposed, and the colour (from the variant, else its
 * colourway) and size codes are confirmed. A variant that already has one
 * keeps it, unless its colourway's code has been changed since (planSkus in
 * lib/style-system.ts). Returns what could not be done, and why, rather
 * than guessing, and any SKU Shopify still shows differently.
 */
export async function assignSkus(productId: string) {
  const p = await db.product.findUnique({
    where: { id: productId },
    include: { style: true, variants: { include: { colorway: true } } },
  })
  if (!p) return { ok: false as const, error: `No product ${productId}.` }
  if (!p.style) return { ok: false as const, error: `${p.name} has no style number yet.` }
  if (p.style.status === 'PROPOSED') return { ok: false as const, error: `${p.name}'s style ${p.style.number} is still proposed; SKUs wait until it is confirmed.` }
  const [codes, taken] = await Promise.all([
    db.styleCode.findMany({ select: { type: true, code: true, status: true } }),
    db.productVariant.findMany({ where: { newSku: { not: null }, productId: { not: p.id } }, select: { newSku: true } }),
  ])
  const steps = planSkus(
    p.style.number,
    p.variants.map((v) => ({
      id: v.id, label: [v.colorway?.customerName, v.size].filter(Boolean).join(' / ') || 'the one variant',
      newSku: v.newSku, colorCode: v.colorCode, sizeCode: v.sizeCode, size: v.size,
      colorwayCode: v.colorway?.colorCode ?? null, shopifySku: v.shopifySku,
    })),
    (t, c) => codes.find((x) => x.type === t && x.code === c)?.status ?? null,
    new Set(taken.map((t) => t.newSku!)),
    sizeCodeFor,
  )
  const sets = steps.filter((x) => x.kind === 'set')
  if (sets.length) await db.$transaction(sets.map((x) => db.productVariant.update({ where: { id: x.id }, data: { newSku: x.sku, colorCode: x.color, sizeCode: x.size } })))
  return {
    ok: true as const, style: p.style.number,
    assigned: sets.filter((x) => !x.from).map((x) => `${x.label} → ${x.sku}`),
    recoded: sets.filter((x) => x.from).map((x) => `${x.label}: ${x.from} → ${x.sku}`),
    notYet: steps.flatMap((x) => (x.kind === 'wait' ? [`${x.label}: ${x.why}`] : [])),
    // The app does not write SKUs to Shopify: say these need changing on the listing.
    shopifyStillReads: sets.filter((x) => x.shopifySku && x.shopifySku !== x.sku).map((x) => `${x.label}: Shopify shows ${x.shopifySku}, the app now ${x.sku}`),
  }
}

/** Put a colour code on a colourway: an existing code, or a new one proposed. */
export async function setColourCode(colorwayId: string, code: string, name?: string) {
  const cw = await db.colorway.findUnique({ where: { id: colorwayId }, select: { id: true, customerName: true } })
  if (!cw) return { ok: false as const, error: `No colourway ${colorwayId}.` }
  const r = await proposeCode('COLOR', code, name ?? cw.customerName)
  if (!r.ok) return r
  await db.colorway.update({ where: { id: cw.id }, data: { colorCode: r.code } })
  return { ok: true as const, code: r.code, status: r.status, questionId: r.questionId }
}
