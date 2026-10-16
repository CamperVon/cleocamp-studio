/**
 * Style numbers and SKUs. The spec lives in docs/style-system/style-system.md.
 *
 * Since 16 Oct 2026 (Prompt 4, replacing the 8 Oct TP101 system): a style
 * number is three letters and three digits, TCO101. Letter 1 is the
 * category, letters 2-3 the product (from its name), digit 1 the line
 * (1 women's, 5 men's, 7 unisex), digits 2-3 the version, 01 first. A style
 * is a pattern plus its construction: a new colour or material on the same
 * pattern and build is a colourway; a different construction or cost sheet
 * (an extra lining) is a new style. A SKU is STYLE-COLOUR-SIZE: TCO101-BLK-01.
 * The old TP101-era numbers are retired, never reused, and still found.
 *
 * Everything here is pure, so the rules are tested rather than trusted.
 */

/** The SKU format, exactly as docs/style-system/style-system.md gives it. */
export const SKU_RE = /^[A-Z]{3}[157]\d{2}-[A-Z]{3}-(\d{2}|XS|SM|MD|LG|XL|PT|OS)$/
export const STYLE_RE = /^[A-Z]{3}[157]\d{2}$/
/** The 8 Oct 2026 formats (TP101, TP101-BLK-01): retired, never valid for anything new, still recognised. */
export const OLD_STYLE_RE = /^[A-Z]{2}\d{3}$/
export const OLD_SKU_RE = /^[A-Z]{2}\d{3}-[A-Z]{3}-(\d{2}|XS|SM|MD|LG|XL|PT|OS)$/

/** Letter 1 of a style number. Reserved letters are kept for later and confirmed before first use. */
export const CATEGORIES: ReadonlyArray<{ code: string; name: string; reserved?: true }> = [
  { code: 'T', name: 'Tees' },
  { code: 'U', name: 'Tops (blouses, shirts)', reserved: true },
  { code: 'S', name: 'Sweaters' },
  { code: 'B', name: 'Bottoms (pants and skirts)' },
  { code: 'D', name: 'Dresses' },
  { code: 'H', name: 'Handbags' },
  { code: 'A', name: 'Accessories' },
  { code: 'I', name: 'Intimates' },
  { code: 'O', name: 'Other' },
  { code: 'X', name: 'Parts and components' },
  { code: 'J', name: 'Jackets', reserved: true },
]

/** Digit 1 of a style number. 7 is reserved. */
export const LINES: Readonly<Record<string, string>> = { '1': "women's", '5': "men's", '7': 'unisex' }

/** A style number's parts, or null if it is not one. Pure. */
export function parseStyle(n: string): { category: string; family: string; line: string; version: number } | null {
  const s = n.trim().toUpperCase()
  if (!STYLE_RE.test(s)) return null
  return { category: s[0], family: s.slice(0, 3), line: s[3], version: Number(s.slice(4)) }
}

/**
 * Why a new style number cannot be used, or null if it can. `taken` holds
 * every number ever used: current ones, and the retired, including the old
 * TP101-era numbers. Pure.
 */
export function styleProblem(n: string, taken: ReadonlySet<string>): string | null {
  const s = n.trim().toUpperCase()
  if (OLD_STYLE_RE.test(s)) return `${s} is in the old format (two letters, three digits), retired on 16 Oct 2026. Style numbers are now three letters and three digits, e.g. TCO101.`
  const p = parseStyle(s)
  if (!p) return `"${n}" is not a style number: three letters (category, then two for the product) and three digits (line 1, 5 or 7, then a two-digit version), e.g. TCO101.`
  if (!CATEGORIES.some((c) => c.code === p.category)) return `${p.category} is not a category letter (${CATEGORIES.map((c) => c.code).join(', ')}).`
  if (p.version < 1) return `The version starts at 01: ${p.family}${p.line}01.`
  if (taken.has(s)) return `${s} has been used before. A style number is never reused, retired ones included.`
  return null
}

/**
 * The next version of an existing product family within one line: the
 * highest version used (retired included) plus one, e.g. TCO101 → TCO102.
 * Only for a redesign customers would see as a different version, never a
 * new colour or a pattern revision. The first number of a new family is a
 * person's choice of letters. Pure.
 */
export function nextVersion(family: string, line: string, existing: Iterable<string>): string {
  const f = family.trim().toUpperCase()
  const used = [...existing].map((n) => parseStyle(n)).filter((p): p is NonNullable<typeof p> => !!p && p.family === f && p.line === line).map((p) => p.version)
  return `${f}${line}${String(Math.max(0, ...used) + 1).padStart(2, '0')}`
}

/**
 * Letters 2-3 suggested from a product's name: the first letters of its
 * first two words, or the first two letters of a one-word name, skipping
 * words like "the" and "and". A suggestion only: a person picks the letters.
 * Pure.
 */
export function suggestFamilyLetters(name: string): string | null {
  const words = name.toUpperCase().replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['THE', 'AND', 'OF', 'A'].includes(w))
  const letters = words.map((w) => w.replace(/[^A-Z]/g, '')).filter(Boolean)
  if (!letters.length) return null
  if (letters.length === 1) return letters[0].length >= 2 ? letters[0].slice(0, 2) : null
  return letters[0][0] + letters[1][0]
}

export type StyleStatusName = 'ACTIVE' | 'DRAFT' | 'DEVELOPMENT' | 'NOT_LIVE' | 'LIVE_ONLY' | 'PROPOSED' | 'RETIRED'

/** "NOT LIVE" in the files is NOT_LIVE here. Null for anything not on the list. */
export function styleStatus(s: string): StyleStatusName | null {
  const k = s.trim().toUpperCase().replace(/\s+/g, '_')
  return (['ACTIVE', 'DRAFT', 'DEVELOPMENT', 'NOT_LIVE', 'LIVE_ONLY', 'PROPOSED', 'RETIRED'] as const).find((x) => x === k) ?? null
}

/** Why a SKU cannot be used, or null if it can. `taken` is every SKU already assigned elsewhere. Pure. */
export function skuProblem(sku: string, parts: { style: string; color: string; size: string }, taken: Set<string> = new Set()): string | null {
  if (!SKU_RE.test(sku)) return `"${sku}" is not a SKU: it must read like TCO101-BLK-01 (style, 3-letter colour, size code).`
  if (sku !== `${parts.style}-${parts.color}-${parts.size}`) return `"${sku}" does not equal ${parts.style}-${parts.color}-${parts.size}, its style, colour and size.`
  if (taken.has(sku)) return `${sku} is already used by another variant. SKUs are unique.`
  return null
}

/**
 * What assign_skus does to each variant of one product. Pure.
 *
 * A variant without a SKU gets one where every part is confirmed. A variant
 * that has one keeps it, unless its colourway's colour code has since been
 * changed (12 Oct 2026: the Cosmo Tee's colourway went from RST to CST and
 * the three variants kept TP102-RST-0x, with assign_skus reporting nothing
 * either way). Then, once the new code is confirmed, the SKU is rebuilt from
 * it; until then it is reported as waiting, never left silently. Any new SKU
 * that differs from what Shopify last showed is listed, so the listing gets
 * changed to match.
 */
export type SkuVariant = {
  id: string
  label: string
  newSku: string | null
  colorCode: string | null
  sizeCode: string | null
  size: string | null
  colorwayCode: string | null
  shopifySku: string | null
}
export type SkuStep =
  | { kind: 'set'; id: string; label: string; sku: string; color: string; size: string; from: string | null; shopifySku: string | null }
  | { kind: 'wait'; label: string; why: string }
  | { kind: 'keep'; sku: string }

export function planSkus(style: string, variants: SkuVariant[], codeStatus: (type: 'COLOR' | 'SIZE', code: string) => string | null, taken: Set<string>, sizeCodeFor: (size: string | null) => string | null): SkuStep[] {
  const used = new Set(taken)
  // Kept SKUs are claimed first, so a rebuilt one cannot take another variant's.
  const recode = (v: SkuVariant) => !!v.newSku && !!v.colorwayCode && v.colorCode !== v.colorwayCode
  for (const v of variants) if (v.newSku && !recode(v)) used.add(v.newSku)
  return variants.map((v): SkuStep => {
    if (v.newSku && !recode(v)) return { kind: 'keep', sku: v.newSku }
    const color = recode(v) ? v.colorwayCode! : v.colorCode ?? v.colorwayCode
    const size = v.sizeCode ?? sizeCodeFor(v.size)
    const still = v.newSku ? ` It still reads ${v.newSku}.` : ''
    if (!color) return { kind: 'wait', label: v.label, why: 'no colour code (set one on the colourway)' }
    if (!size) return { kind: 'wait', label: v.label, why: `size "${v.size}" has no code` }
    const cs = codeStatus('COLOR', color)
    if (cs !== 'CONFIRMED') return { kind: 'wait', label: v.label, why: `colour ${color} is ${cs ? 'not confirmed yet' : 'not a code'}.${still}` }
    if (codeStatus('SIZE', size) !== 'CONFIRMED') return { kind: 'wait', label: v.label, why: `size ${size} is not confirmed.${still}` }
    const sku = `${style}-${color}-${size}`
    const problem = skuProblem(sku, { style, color, size }, used)
    if (problem) return { kind: 'wait', label: v.label, why: `${problem}${still}` }
    used.add(sku)
    return { kind: 'set', id: v.id, label: v.label, sku, color, size, from: v.newSku, shopifySku: v.shopifySku }
  })
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
