import { CATEGORIES, OLD_SKU_RE, SKU_RE, STYLE_RE } from '@/lib/style-system'

/**
 * The 16 Oct 2026 re-key (Prompt 4): every TP101-era style number to its new
 * one, and every SKU with it. Pure: the plan is worked out here from a
 * snapshot of the database and applied by scripts/rekey-styles.ts, so what it
 * will do is tested before it runs.
 *
 * `products` names the products that move to the new number. A row with no
 * `from` is a new style; a row with no `to` loses its number (Dolce).
 */
export type RekeyRow = { from: string | null; to: string | null; name: string; products: string[]; note?: string; create?: { product: string; status: 'DEVELOPMENT' } }

export const REKEY: ReadonlyArray<RekeyRow> = [
  { from: 'TP101', to: 'TCO101', name: 'Cleo Tee', products: ['Cleo Tee'] },
  { from: 'TP102', to: 'TCC101', name: 'Cleo Tee Cosmo', products: ['Cosmo Stripe Tee'] },
  { from: null, to: 'TCW101', name: "Cleo Tee Wilde's", products: [], note: "Holiday collaboration with Wilde's LA.", create: { product: "Cleo Tee Wilde's", status: 'DEVELOPMENT' } },
  { from: 'TP105', to: 'TCL101', name: 'Long Sleeve Cleo Tee', products: ['Long Sleeve Cleo Tee'] },
  { from: 'TP104', to: 'TCT101', name: 'Cleo Tank', products: ['Cleo Tank'] },
  { from: 'TP103', to: 'SFR101', name: 'Cleo Sweater', products: ['Cleo Sweater'], note: 'Working name "Frenchie".' },
  { from: 'DR103', to: 'DCT101', name: 'Cleo Tee Dress', products: ['Cleo Tee Dress'] },
  { from: 'DR102', to: 'DST101', name: 'Story Dress', products: ['Story Dress'] },
  { from: 'DR101', to: 'DYO101', name: 'You Dress', products: ['You Dress'] },
  { from: 'DR104', to: 'DSN101', name: 'Scoop Neck Dress', products: ['Scoop Neck Dress'] },
  { from: 'DR105', to: 'DXM101', name: 'Christmas Dress', products: ['Christmas Dress'] },
  { from: 'DR106', to: null, name: 'Dolce', products: ['Dolce'], note: 'Style number removed 16 Oct 2026; unnumbered until decided.' },
  { from: 'BT101', to: 'BFS101', name: '5to7 Skirt', products: ['5to7 Skirt'] },
  { from: 'BT102', to: 'BTU101', name: 'Tutu', products: ['Tutu'] },
  { from: 'IN101', to: 'ICU101', name: 'Cleo Underwear', products: ['Cleo Underwear'] },
  { from: 'BG101', to: 'HCB101', name: 'Cleo Bag', products: ['Cleo Bag', 'Cleo Bag — Black', 'Cleo Bag — Chocolate', 'Cleo Bag — Olive', 'Cleo Bag — Silver'], note: 'Olive is a colourway: same pattern and build.' },
  { from: 'BG101', to: 'HCD101', name: 'Cleo Bag Denim', products: ['Cleo Bag — Denim'], note: 'Split from the Cleo Bag: double lining is a different construction.' },
  { from: 'BG102', to: 'HLS101', name: 'Little Sister', products: ['Little Sister'] },
  { from: 'BG103', to: 'HBT101', name: 'Bateau Bag', products: ['Bateau Bag'] },
  { from: 'BG104', to: 'HPB101', name: 'Petite Bateau Bag', products: ['Petite Bateau Bag'] },
  { from: 'BG105', to: 'HBN101', name: 'Bean Bag', products: ['Bean Bag'], note: 'All colourways, Red, Cannellini and Espresso included. The duplicate "Red Bag" record was merged in.' },
  { from: 'BG106', to: 'HCA101', name: 'Cachet', products: ['Cachet'] },
  { from: 'AC101', to: 'ABB101', name: 'Boy Belt', products: ['Boy Belt', 'Boy Belt - Black', 'Boy Belt - White'] },
  { from: 'AC102', to: 'ABH101', name: 'Bateau Handle', products: ['Bateau Handle'] },
  { from: 'AC103', to: 'AFH101', name: 'Flower Hair Tie', products: ['Flower Hair Tie'], note: 'The duplicate "Hair Tie" record was merged in.' },
  { from: 'AC104', to: 'ASR101', name: 'Sardine', products: ['Sardine'] },
  { from: 'AC105', to: 'ASF101', name: 'Silk Flowers (name TBD)', products: ['Silk Flowers (name TBD)'] },
  { from: 'OT101', to: 'OSP101', name: 'Splash Photo Book', products: ['Splash Photo Book'] },
  { from: 'PT101', to: 'XBT101', name: 'Bateau Body', products: ['Bateau Body — Muslin Canvas (part)'] },
  { from: 'PT102', to: 'XPB101', name: 'Petite Bateau Body', products: ['Petite Bateau Body — Muslin Canvas (part)'] },
]

/** Duplicate records folded into the real one: [duplicate, keeper]. Both are names in the app. */
export const MERGES: ReadonlyArray<[string, string]> = [['Red Bag', 'Bean Bag'], ['Hair Tie', 'Flower Hair Tie']]

export type SnapStyle = { id: string; number: string; name: string; status: string; sizes: string | null; notes: string | null; products: Array<{ id: string; name: string }> }
export type SnapVariant = { id: string; productId: string; newSku: string | null; colorCode: string | null; sizeCode: string | null }

export type RekeyPlan = {
  /** Existing style rows renumbered in place: their products follow. */
  renumber: Array<{ id: string; from: string; to: string; category: string; name: string; notes: string | null }>
  /** New style rows, with the existing products that move onto them, or a product to create. */
  create: Array<{ number: string; category: string; name: string; status: string; sizes: string | null; notes: string | null; productIds: string[]; createProduct?: { name: string; status: 'DEVELOPMENT' } }>
  /** Products left with no style number. */
  unlink: Array<{ productId: string; name: string; from: string }>
  /** Style rows removed once their products have moved or been unlinked. */
  remove: Array<{ id: string; number: string }>
  /** Every old number, kept for search and never reused. */
  retire: Array<{ number: string; replacedBy: string | null; note: string }>
  /** Every variant with a SKU: the TP-era one kept as previousSku. */
  skus: Array<{ id: string; from: string; to: string }>
  /** Anything that does not fit the table. If there are any, nothing is applied. */
  problems: string[]
}

const tail = (sku: string) => sku.split('-').slice(1).join('-')

/** Old style numbers in free text swapped for their replacements (a split one keeps its first). Pure. */
export function swapCodes(text: string): string {
  const to = new Map<string, string>()
  for (const r of REKEY) if (r.from && r.to && !to.has(r.from)) to.set(r.from, r.to)
  return text.replace(/\b([A-Z]{2}\d{3})\b/g, (m) => to.get(m) ?? m)
}

/** A style's notes after the re-key: what it said, codes swapped, and the table's note when it adds something. Pure. */
export function rekeyedNotes(old: string | null, note: string | undefined): string | null {
  const kept = old ? swapCodes(old) : ''
  if (!note || kept.includes(note)) return kept || null
  return kept ? `${kept} ${note}` : note
}

/** The re-key, worked out from what is in the database. Pure. */
export function planRekey(styles: SnapStyle[], variants: SnapVariant[], merged: ReadonlySet<string> = new Set(MERGES.map(([d]) => d))): RekeyPlan {
  const plan: RekeyPlan = { renumber: [], create: [], unlink: [], remove: [], retire: [], skus: [], problems: [] }
  const byNumber = new Map(styles.map((s) => [s.number, s]))
  const newNumberOfProduct = new Map<string, string | null>()
  const claimed = new Set<string>()

  for (const row of REKEY) {
    if (row.to && !STYLE_RE.test(row.to)) plan.problems.push(`${row.to} does not pass the new style format.`)
    if (row.to && !CATEGORIES.some((c) => c.code === row.to![0])) plan.problems.push(`${row.to} starts with no category letter.`)
  }

  // Which rows share an old number (BG101 splits in two): the first keeps the row, the rest are new rows.
  const firstFor = new Map<string, RekeyRow>()
  for (const row of REKEY) if (row.from && !firstFor.has(row.from)) firstFor.set(row.from, row)

  for (const row of REKEY) {
    const old = row.from ? byNumber.get(row.from) : undefined
    if (row.from && !old) { plan.problems.push(`No style ${row.from} in the database (expected for ${row.name}).`); continue }
    const productsHere = old ? old.products : []
    const wanted = row.products.map((name) => ({ name, p: productsHere.find((x) => x.name === name) }))
    for (const w of wanted) if (!w.p) plan.problems.push(`${row.from ?? 'new'} → ${row.to ?? 'none'}: no product "${w.name}" on ${row.from ?? 'it'}.`)
    const ids = wanted.flatMap((w) => (w.p ? [w.p.id] : []))
    ids.forEach((id) => { if (claimed.has(id)) plan.problems.push(`Product ${id} is mapped twice.`); claimed.add(id); newNumberOfProduct.set(id, row.to) })

    const category = row.to ? row.to[0] : ''
    const notes = rekeyedNotes(old?.notes ?? null, row.note)
    if (!row.from) {
      plan.create.push({ number: row.to!, category, name: row.name, status: 'DEVELOPMENT', sizes: 'TBD', notes: row.note ?? null, productIds: [], createProduct: row.create ? { name: row.create.product, status: row.create.status } : undefined })
    } else if (!row.to) {
      for (const id of ids) plan.unlink.push({ productId: id, name: productsHere.find((p) => p.id === id)!.name, from: row.from })
      plan.remove.push({ id: old!.id, number: row.from })
    } else if (firstFor.get(row.from) === row) {
      // The style keeps its name; only its number and category change.
      plan.renumber.push({ id: old!.id, from: row.from, to: row.to, category, name: old!.name, notes })
    } else {
      plan.create.push({ number: row.to, category, name: row.name, status: old!.status, sizes: old!.sizes, notes, productIds: ids })
    }
  }

  // Every product on a mapped style must be accounted for: in the table, or a duplicate being merged.
  for (const s of styles) {
    if (!REKEY.some((r) => r.from === s.number)) { plan.problems.push(`Style ${s.number} (${s.name}) is not in the re-key table.`); continue }
    for (const p of s.products) if (!claimed.has(p.id) && !merged.has(p.name)) plan.problems.push(`Product "${p.name}" on ${s.number} is not in the re-key table.`)
  }

  // Old numbers: retired, each pointing at what replaced it.
  const olds = [...new Set(REKEY.flatMap((r) => (r.from ? [r.from] : [])))]
  for (const n of olds) {
    const rows = REKEY.filter((r) => r.from === n)
    const to = rows.map((r) => r.to).filter((x): x is string => !!x)
    plan.retire.push({
      number: n,
      replacedBy: to[0] ?? null,
      note: to.length > 1 ? `Replaced by ${to.join(' and ')} on 16 Oct 2026 (${rows.map((r) => `${r.to}: ${r.name}`).join('; ')}).`
        : to.length ? `Replaced by ${to[0]} on 16 Oct 2026.` : `${rows[0].name}: style number removed on 16 Oct 2026, unnumbered until decided.`,
    })
  }

  // SKUs: the style part swapped, colour and size untouched.
  const seen = new Set<string>()
  for (const v of variants) {
    if (!v.newSku) continue
    const to = newNumberOfProduct.get(v.productId)
    if (to === undefined) continue // a product on no mapped style
    if (!to) { plan.problems.push(`Variant ${v.id} has SKU ${v.newSku} but its product loses its style number.`); continue }
    if (!OLD_SKU_RE.test(v.newSku)) { plan.problems.push(`Variant ${v.id}'s SKU ${v.newSku} is not in the TP101-era format.`); continue }
    const next = `${to}-${tail(v.newSku)}`
    if (v.colorCode && v.sizeCode && tail(v.newSku) !== `${v.colorCode}-${v.sizeCode}`) plan.problems.push(`${v.newSku} does not match its own colour and size codes (${v.colorCode}-${v.sizeCode}).`)
    if (!SKU_RE.test(next)) plan.problems.push(`${next} does not pass the new SKU format.`)
    if (seen.has(next)) plan.problems.push(`${next} would be used twice.`)
    seen.add(next)
    plan.skus.push({ id: v.id, from: v.newSku, to: next })
  }
  return plan
}
