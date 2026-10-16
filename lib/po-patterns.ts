import { db } from '@/lib/db'
import { nextPatternCode, PATTERN_RE, resolvePattern, type PatternStatusName } from '@/lib/patterns'

/**
 * The reads and writes behind pattern labels (lib/patterns.ts holds the
 * rules). Nothing here touches a variant, a SKU or Shopify.
 */

/**
 * Why this order cannot go to the vendor yet, or null when it can: a
 * cut-and-sew line whose style has two or more patterns in use and none
 * picked, or one picked that has since been archived. Lines already frozen
 * are left alone; they went out with what they said.
 */
export async function patternGate(poId: string, client: typeof db = db): Promise<string | null> {
  const po = await client.purchaseOrder.findUnique({
    where: { id: poId },
    select: {
      vendor: { select: { role: true } },
      lines: {
        orderBy: { id: 'asc' },
        select: {
          snapshotAt: true, productVariantId: true, pattern: true,
          productVariant: { select: { size: true, colorway: { select: { customerName: true } }, product: { select: { name: true, style: { select: { number: true, patterns: true } } } } } },
        },
      },
    },
  })
  if (!po) return null
  const problems: string[] = []
  po.lines.forEach((l, n) => {
    if (l.snapshotAt || !l.productVariant) return
    const style = l.productVariant.product.style
    const r = resolvePattern(l, style ? { number: style.number, patterns: style.patterns } : null, po.vendor.role === 'MANUFACTURER')
    if (r.problem) {
      const what = [l.productVariant.product.name, l.productVariant.colorway?.customerName, l.productVariant.size].filter(Boolean).join(' / ')
      problems.push(`line ${n + 1} (${what}): ${r.problem}`)
    }
  })
  if (!problems.length) return null
  return `Not sent: ${problems.join(' ')} Ask which pattern, then set it with update_purchase_order_lines (patternCode) and send again.`
}

/** A style's patterns, or every style's, for Mouse and the pages. */
export async function listPatterns(styleNumber?: string) {
  return db.pattern.findMany({
    where: styleNumber ? { style: { number: styleNumber } } : {},
    orderBy: { code: 'asc' },
    select: { code: true, description: true, fabric: true, heldBy: true, status: true, since: true, notes: true, style: { select: { number: true, name: true } } },
  })
}

type PatternFields = { description?: string; fabric?: string | null; heldBy?: string | null; status?: PatternStatusName; notes?: string | null }

/** A new pattern for a style, numbered one past its highest ever. */
export async function addPattern(styleNumber: string, f: PatternFields) {
  const style = await db.style.findUnique({ where: { number: styleNumber }, select: { id: true, number: true, status: true, patterns: { select: { code: true } } } })
  if (!style) return { ok: false as const, error: `No style ${styleNumber}.` }
  if (style.status === 'PROPOSED') return { ok: false as const, error: `${styleNumber} is still proposed; confirm the style first.` }
  if (!f.description?.trim()) return { ok: false as const, error: 'Say what the pattern is (description), e.g. "for pre-washed fabric".' }
  const code = nextPatternCode(style.number, style.patterns.map((p) => p.code))
  if (!PATTERN_RE.test(code)) return { ok: false as const, error: `${code} is not a pattern code.` }
  const p = await db.pattern.create({
    data: { styleId: style.id, code, description: f.description.trim(), fabric: f.fabric ?? null, heldBy: f.heldBy ?? null, status: f.status ?? 'ACTIVE', notes: f.notes ?? null },
    select: { code: true, status: true },
  })
  return { ok: true as const, ...p }
}

/** Change what is known about a pattern. Never renumbers it and never deletes it: archive it instead. */
export async function updatePattern(code: string, f: PatternFields) {
  const p = await db.pattern.findUnique({ where: { code }, select: { id: true, status: true } })
  if (!p) return { ok: false as const, error: `No pattern ${code}.` }
  const data: Record<string, unknown> = {}
  for (const k of ['description', 'fabric', 'heldBy', 'notes'] as const) if (f[k] !== undefined) data[k] = f[k]
  if (f.status && f.status !== p.status) Object.assign(data, { status: f.status, since: new Date() })
  if (!Object.keys(data).length) return { ok: false as const, error: 'Nothing to change.' }
  const u = await db.pattern.update({ where: { id: p.id }, data, select: { code: true, description: true, fabric: true, heldBy: true, status: true } })
  return { ok: true as const, ...u }
}

/**
 * Find a pattern by its code for one line's product: it must be one of that
 * product's style's own patterns, and not archived.
 */
export async function patternForLine(code: string, productVariantId: string | null) {
  const p = await db.pattern.findUnique({ where: { code: code.trim().toUpperCase() }, select: { id: true, code: true, status: true, styleId: true } })
  if (!p) return { error: `No pattern ${code}.` }
  if (p.status === 'ARCHIVED') return { error: `${p.code} is archived.` }
  if (!productVariantId) return { error: 'A pattern goes on a product line, not a component or described line.' }
  const v = await db.productVariant.findUnique({ where: { id: productVariantId }, select: { product: { select: { styleId: true, style: { select: { number: true } } } } } })
  if (v?.product.styleId !== p.styleId) return { error: `${p.code} is not a pattern for ${v?.product.style?.number ?? 'this product'}.` }
  return { id: p.id, code: p.code }
}
