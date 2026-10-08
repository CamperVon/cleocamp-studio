/**
 * Style numbers and SKUs (8 Oct 2026). The spec and the data it was seeded
 * from live in docs/style-system/. A style is one pattern: TP101 is the Cleo
 * Tee in every colour and size. A SKU is STYLE-COLOUR-SIZE: TP101-BLK-01.
 *
 * Everything here is pure, so the rules are tested rather than trusted.
 */

/** The SKU format, exactly as docs/style-system/style-system.md gives it. */
export const SKU_RE = /^[A-Z]{2}\d{3}-[A-Z]{3}-(\d{2}|XS|SM|MD|LG|XL|PT|OS)$/
export const STYLE_RE = /^[A-Z]{2}\d{3}$/

export type StyleStatusName = 'ACTIVE' | 'DRAFT' | 'DEVELOPMENT' | 'NOT_LIVE' | 'LIVE_ONLY' | 'PROPOSED' | 'RETIRED'

/** "NOT LIVE" in the files is NOT_LIVE here. Null for anything not on the list. */
export function styleStatus(s: string): StyleStatusName | null {
  const k = s.trim().toUpperCase().replace(/\s+/g, '_')
  return (['ACTIVE', 'DRAFT', 'DEVELOPMENT', 'NOT_LIVE', 'LIVE_ONLY', 'PROPOSED', 'RETIRED'] as const).find((x) => x === k) ?? null
}

/** Why a SKU cannot be used, or null if it can. `taken` is every SKU already assigned elsewhere. Pure. */
export function skuProblem(sku: string, parts: { style: string; color: string; size: string }, taken: Set<string> = new Set()): string | null {
  if (!SKU_RE.test(sku)) return `"${sku}" is not a SKU: it must read like TP101-BLK-01 (style, 3-letter colour, size code).`
  if (sku !== `${parts.style}-${parts.color}-${parts.size}`) return `"${sku}" does not equal ${parts.style}-${parts.color}-${parts.size}, its style, colour and size.`
  if (taken.has(sku)) return `${sku} is already used by another variant. SKUs are unique.`
  return null
}

/**
 * The next style number in a category: the highest ever used, plus one.
 * Retired and proposed numbers count, so no number is ever handed out twice.
 * Starts at 101. Pure.
 */
export function nextStyleNumber(category: string, existing: string[]): string {
  const cat = category.trim().toUpperCase()
  const used = existing.filter((n) => n.startsWith(cat) && STYLE_RE.test(n)).map((n) => Number(n.slice(2)))
  return `${cat}${Math.max(100, ...used) + 1}`
}

/**
 * A size as this app stores it ("1", "Small", "S", "Petite", none) as its
 * code. Null for anything that is not plainly one of the codes: never a
 * guess. Pure.
 */
export function sizeCodeFor(size: string | null | undefined): string | null {
  if (size === null || size === undefined || !size.trim()) return 'OS'
  const s = size.trim().toLowerCase().replace(/^size\s+/, '')
  if (/^\d$/.test(s)) return `0${s}`
  if (/^\d\d$/.test(s)) return s
  const words: Record<string, string> = {
    xs: 'XS', 'extra small': 'XS', 'x-small': 'XS', s: 'SM', sm: 'SM', small: 'SM', m: 'MD', md: 'MD', medium: 'MD',
    l: 'LG', lg: 'LG', large: 'LG', xl: 'XL', 'extra large': 'XL', 'x-large': 'XL', pt: 'PT', petite: 'PT',
    os: 'OS', 'one size': 'OS', 'default title': 'OS',
  }
  return words[s] ?? null
}

/** Words of a colour name, order and punctuation aside: "Green (Betsey)" and "Betsey (Green)" are one name. Pure. */
export function colourKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ')
}

/** A tiny CSV reader for the files in docs/style-system (quoted fields, commas inside quotes). Pure. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c !== '')) rows.push(row)
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

// ── Matching the app's variants to the SKU list ──────────────────────────

export type SkuRow = { sku: string; style: string; color: string; colorway: string; size: string; variantTitle: string }
export type AppVariant = { id: string; productId: string; productName: string; colorway: string | null; size: string | null }

/**
 * Names that mean the same colour, from the decisions already made (Brandon,
 * 8 Oct 2026) and the style note: Ruby Red is the Cleo Tee's RED; Splash
 * Neverworns is SPS, "Splash, the Neverworns print".
 */
export const COLOUR_ALIASES: Record<string, string> = {
  [colourKey('Ruby Red')]: colourKey('Red'),
  [colourKey('Splash Neverworns')]: colourKey('Splash'),
}

/**
 * Every name the app might use for this variant's colour: its colourway, and
 * for a product per colour ("Cleo Bag — Silver") the part after the dash,
 * alone and with the colourway ("Denim Baby Blue"). Pure.
 */
export function appColourNames(v: AppVariant): Set<string> {
  const out = new Set<string>()
  const add = (s: string | null | undefined) => {
    if (!s || !s.trim()) return
    const k = colourKey(s)
    out.add(COLOUR_ALIASES[k] ?? k)
  }
  add(v.colorway)
  const suffix = v.productName.includes(' — ') ? v.productName.split(' — ').slice(1).join(' — ') : null
  if (suffix) { add(suffix); if (v.colorway) add(`${suffix} ${v.colorway}`) }
  return out
}

/** Every name the SKU list uses for a row's colour: its colourway and the colour part of Shopify's variant title. Pure. */
export function rowColourNames(r: SkuRow): Set<string> {
  const out = new Set<string>()
  out.add(colourKey(r.colorway))
  const part = r.variantTitle.split(' / ')[0]
  if (part && !/^default title$/i.test(part) && sizeCodeFor(part) === null) out.add(colourKey(part))
  return out
}

export type MatchReport = {
  matched: Array<{ row: SkuRow; variant: AppVariant }>
  ambiguous: Array<{ row?: SkuRow; variant?: AppVariant; candidates: string[] }>
  unmatchedRows: SkuRow[]
  unmatchedVariants: AppVariant[]
}

/**
 * Match the SKU list to the app's variants, style by style, on colour and
 * size. `byStyle` says which app products are each style. Nothing is forced:
 * a row or variant with more than one possible partner is ambiguous, one with
 * none is unmatched. A variant with no colourway matches on size alone only
 * when its style has a single colour in the list. Pure.
 */
export function matchVariants(rows: SkuRow[], variants: AppVariant[], byStyle: Map<string, Set<string>>): MatchReport {
  const report: MatchReport = { matched: [], ambiguous: [], unmatchedRows: [], unmatchedVariants: [] }
  const styleOfProduct = new Map<string, string>()
  for (const [style, ids] of byStyle) for (const id of ids) styleOfProduct.set(id, style)
  const coloursInStyle = new Map<string, Set<string>>()
  for (const r of rows) coloursInStyle.set(r.style, (coloursInStyle.get(r.style) ?? new Set()).add(r.color))

  const fits = (r: SkuRow, v: AppVariant): boolean => {
    if (styleOfProduct.get(v.productId) !== r.style) return false
    if (sizeCodeFor(v.size) !== r.size) return false
    // No colourway of its own, in a style with one colour: that colour. A
    // product named for something else ("Bateau Body — Muslin Canvas") is
    // not thereby a colour.
    if (!v.colorway && coloursInStyle.get(r.style)!.size === 1) return true
    const names = appColourNames(v)
    if (!names.size) return false
    const want = rowColourNames(r)
    return [...names].some((n) => want.has(n))
  }

  const rowsFor = new Map<string, SkuRow[]>()
  const variantsFor = new Map<string, AppVariant[]>()
  for (const r of rows) {
    const vs = variants.filter((v) => fits(r, v))
    variantsFor.set(r.sku, vs)
    for (const v of vs) rowsFor.set(v.id, [...(rowsFor.get(v.id) ?? []), r])
  }
  for (const r of rows) {
    const vs = variantsFor.get(r.sku)!
    if (!vs.length) { report.unmatchedRows.push(r); continue }
    if (vs.length > 1) { report.ambiguous.push({ row: r, candidates: vs.map((v) => `${v.productName} ${v.colorway ?? ''} ${v.size ?? ''}`.trim()) }); continue }
    const back = rowsFor.get(vs[0].id)!
    if (back.length > 1) continue // reported once, from the variant's side, below
    report.matched.push({ row: r, variant: vs[0] })
  }
  for (const v of variants) {
    const rs = rowsFor.get(v.id) ?? []
    if (rs.length > 1) report.ambiguous.push({ variant: v, candidates: rs.map((r) => r.sku) })
    else if (!rs.length && styleOfProduct.has(v.productId)) report.unmatchedVariants.push(v)
  }
  return report
}
