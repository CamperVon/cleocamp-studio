import path from 'node:path'
import { Document, Page, Text, View, Image, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { db } from '@/lib/db'
import { wordmark, WORDMARK_RATIO } from '@/lib/brand'

/**
 * The wholesale line sheet: what stores see before they order. Brandon,
 * 30 Sept 2026: "In the wholesale section I want to build a line sheet that
 * mouse can update and send as a pdf as we go", laid out like
 * Cleo_Line_Sheet_2026 (January 2026): photo, item, colour, description,
 * wholesale, suggested retail, sizing, minimum order, commission,
 * availability, then press, contact and a footnote.
 *
 * Prices are never copied onto the sheet. Wholesale comes from the price
 * list (the variant's, then the product's), and suggested retail from the
 * Shopify price the nightly sync keeps on each variant, both read when the
 * sheet is drawn. The January sheet had drifted from both (Denim $98 against
 * $115, Bean Bag Petite retail $348 against Shopify's $368), which is the
 * whole reason not to keep a second copy.
 *
 * Suggested retail is Shopify's price, always, for anything we sell as a
 * product (Brandon, 30 Sept 2026: "Suggested retail should be Shopify
 * price"). The written ranges carried over from January ("$88 – $128+") are
 * gone; a row's own msrp prints only for something with no product behind
 * it, like the custom pouches.
 *
 * New things join by themselves (Brandon, same day: "It should include new
 * products as we add them"): addNewToLineSheet, run whenever the sheet is
 * read, gives a row to every active product, and every active colour of one,
 * that is for sale on Shopify and not on the sheet yet. A row a person
 * removed stays removed. A row stays off the PDF until it has a wholesale
 * price and a description, and the Wholesale page says so. The description
 * is the row's own words if someone wrote them, else the product's Shopify
 * description (first paragraph), which the nightly sync keeps.
 *
 * Fonts come off disk for the reasons given at the top of lib/po-pdf.tsx.
 */
const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
Font.register({
  family: 'PTSerif',
  fonts: [
    { src: path.join(FONT_DIR, 'PTSerif-Regular.ttf') },
    { src: path.join(FONT_DIR, 'PTSerif-Bold.ttf'), fontWeight: 'bold' },
    { src: path.join(FONT_DIR, 'PTSerif-Italic.ttf'), fontStyle: 'italic' },
    { src: path.join(FONT_DIR, 'PTSerif-BoldItalic.ttf'), fontWeight: 'bold', fontStyle: 'italic' },
  ],
})
Font.registerHyphenationCallback((word) => [word])

export type LineSheetMetaText = { title: string; tagline: string; materials: string; press: string; contact: string; footnote: string }

export type LineSheetLine = {
  id: string
  position: number
  productId: string | null
  colorway: string | null
  item: string
  colorLabel: string
  /** What prints: the row's own words, or else the product's Shopify description. */
  description: string
  /** The row's own words, for the editor. Empty: it prints Shopify's. */
  ownDescription: string
  /** What prints: the live price, or the row's own when it has no product. Null: not set anywhere. The lowest when variants differ. */
  wholesaleCents: number | null
  /** The highest, when the row's variants are priced differently (Sardine: Naked $40, Beaded $44). Else null. */
  wholesaleMaxCents: number | null
  retail: string | null
  msrp: string | null
  sizing: string
  minOrder: string
  commission: string | null
  availability: string
  photo: string | null
  /** A photo chosen and cropped for the sheet, used instead of photo when set. */
  photoData: Buffer | null
  /** For the team only, never printed: Shopify's on-hand for what the row sells. */
  onHand: number | null
  hidden: boolean
}

type Variant = { wholesalePriceCents: number | null; retailPriceCents: number | null; imageUrl: string | null; onHandQty: unknown; colorway: { customerName: string } | null }
type Product = { id: string; wholesalePriceCents: number | null; retailPriceCents: number | null; shopifyDescription?: string | null; variants: Variant[] }

/**
 * Shopify's description cut to fit the sheet's column: the first paragraph,
 * and at most about 320 characters, ended at a sentence. Pure.
 */
export function sheetDescription(text: string | null | undefined): string {
  // "Size Guide" is a link on the website, meaningless on paper.
  const para = (text ?? '').replace(/\s*\bSize Guide\b\s*/gi, ' ').trim().split(/\n\s*\n|\n/)[0]?.trim() ?? ''
  if (para.length <= 320) return para
  const cut = para.slice(0, 320)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

/** "$54", "$54.50". Pure. */
export function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
}

/** Does a row's colourway ("Red") mean this colour ("Red (Wiltshire)")? Loose on purpose. Pure. */
function sameColour(row: string, colour: string): boolean {
  const a = row.trim().toLowerCase()
  const b = colour.trim().toLowerCase()
  return a === b || b.startsWith(a)
}

/** The variants a row means: its colourway's, or all of them. Matched loosely: "Red" finds "Red (Wiltshire)". Pure. */
export function variantsFor<V extends Pick<Variant, 'colorway'>>(p: { variants: V[] }, colorway: string | null): V[] {
  if (!colorway) return p.variants
  const want = colorway.trim().toLowerCase()
  const exact = p.variants.filter((v) => v.colorway?.customerName.toLowerCase() === want)
  return exact.length ? exact : p.variants.filter((v) => v.colorway && sameColour(colorway, v.colorway.customerName))
}

export type SheetCandidate = {
  id: string
  name: string
  variants: Array<{ size: string | null; shopifyVariantId: string | null; colorway: { customerName: string; active: boolean } | null }>
}
export type NewRow = { productId: string; item: string; colorway: string | null; colorLabel: string; sizing: string }

/**
 * What the sheet is missing: a product with no row at all (one row, all its
 * colours), or a colour of one already listed colour by colour. Only what is
 * for sale on Shopify counts (a variant with a Shopify id, in an active
 * colour); Bean Bag Red, sold only in person, is added by hand if wanted. Any
 * row counts as present, removed ones too, so a removal sticks. Pure.
 */
export function missingRows(products: SheetCandidate[], rows: Array<{ productId: string | null; colorway: string | null }>): NewRow[] {
  const out: NewRow[] = []
  for (const p of products) {
    if (/\(part\)/i.test(p.name)) continue
    const selling = p.variants.filter((v) => v.shopifyVariantId && (!v.colorway || v.colorway.active))
    if (!selling.length) continue
    const mine = rows.filter((r) => r.productId === p.id)
    if (mine.some((r) => !r.colorway)) continue
    const colours = [...new Set(selling.map((v) => v.colorway?.customerName).filter((c): c is string => !!c))]
    const sizes = (colour: string | null) => {
      const s = [...new Set(selling.filter((v) => !colour || v.colorway?.customerName === colour).map((v) => v.size?.trim()).filter((x): x is string => !!x))]
      return s.length > 1 ? s.join(', ') : ''
    }
    // A new product: one row, its colours listed. Split it by colour later if wanted.
    if (!mine.length) {
      out.push({ productId: p.id, item: p.name, colorway: null, colorLabel: colours.join(', '), sizing: sizes(null) })
      continue
    }
    // Already sold colour by colour: a row for each colour it lacks.
    for (const c of colours) {
      if (mine.some((r) => r.colorway && sameColour(r.colorway, c))) continue
      out.push({ productId: p.id, item: p.name, colorway: c, colorLabel: c, sizing: sizes(c) })
    }
  }
  return out
}

/**
 * Give the sheet a row for anything new (see missingRows). Written in one
 * transaction under an advisory lock, because the Wholesale page and the PDF
 * can read the sheet at the same moment and each would otherwise add the
 * same row. The words a store reads (description, availability, minimum)
 * start blank rather than guessed; the Wholesale page flags them.
 */
export async function addNewToLineSheet(): Promise<NewRow[]> {
  const products = await db.product.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true, name: true,
      variants: { orderBy: { size: 'asc' }, select: { size: true, shopifyVariantId: true, colorway: { select: { customerName: true, active: true } } } },
    },
    orderBy: { name: 'asc' },
  })
  const rows = await db.lineSheetRow.findMany({ select: { productId: true, colorway: true } })
  if (!missingRows(products, rows).length) return []
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(740301)`
    const now = await tx.lineSheetRow.findMany({ orderBy: { position: 'asc' }, select: { productId: true, colorway: true, position: true } })
    const add = missingRows(products, now)
    const taken = now.map((r) => r.position)
    for (const r of add) {
      // Beside its own product's rows when there is room, else at the end.
      const last = [...now].reverse().find((x) => x.productId === r.productId)
      const next = last ? taken.filter((t) => t > last.position).sort((a, b) => a - b)[0] : undefined
      const position = last && next != null && next - last.position > 1
        ? Math.floor((last.position + next) / 2)
        : Math.max(0, ...taken) + 10
      taken.push(position)
      now.push({ productId: r.productId, colorway: r.colorway, position })
      await tx.lineSheetRow.create({
        data: { position, productId: r.productId, colorway: r.colorway, item: r.item, colorLabel: r.colorLabel, description: '', sizing: r.sizing, minOrder: '', availability: '' },
      })
    }
    return add
  })
}

/** Price, suggested retail, photo and stock for one row, from its product as it is now. Pure. */
export function resolveRow(
  row: { colorway: string | null; wholesaleCents: number | null; msrp: string | null; description?: string },
  p: Product | null,
): Pick<LineSheetLine, 'wholesaleCents' | 'wholesaleMaxCents' | 'retail' | 'photo' | 'onHand' | 'description'> {
  const own = row.description?.trim() ?? ''
  if (!p) return { wholesaleCents: row.wholesaleCents, wholesaleMaxCents: null, retail: row.msrp, photo: null, onHand: null, description: own }
  // Suggested retail is Shopify's, whatever the row says.
  const vs = variantsFor(p, row.colorway)
  // Each variant's own price, else the product's: a row covering two prices
  // prints both ends, never just the first one found.
  const base = p.wholesalePriceCents ?? row.wholesaleCents
  const each = [...new Set((vs.length ? vs.map((v) => v.wholesalePriceCents ?? base) : [base]).filter((c): c is number => c != null))].sort((a, b) => a - b)
  const ws = each[0] ?? null
  const wsMax = each.length > 1 ? each[each.length - 1] : null
  const prices = [...new Set(vs.map((v) => v.retailPriceCents).filter((c): c is number => c != null))].sort((a, b) => a - b)
  const live = prices.length
    ? prices.length > 1 ? `${dollars(prices[0])} – ${dollars(prices[prices.length - 1])}` : dollars(prices[0])
    : p.retailPriceCents != null ? dollars(p.retailPriceCents) : null
  const counts = vs.map((v) => (v.onHandQty == null ? null : Number(v.onHandQty)))
  return {
    wholesaleCents: ws,
    wholesaleMaxCents: wsMax,
    retail: live,
    description: own || sheetDescription(p.shopifyDescription),
    photo: vs.find((v) => v.imageUrl)?.imageUrl ?? null,
    onHand: counts.some((c) => c == null) || !counts.length ? null : counts.reduce((a, b) => a! + b!, 0),
  }
}

export type ChargedDifferently = { key: string; product: string; charged: number[]; list: number[]; account: string; invoice: string | null; sentAt: Date }

/** The Note entityId that marks one invoice's price for one product as a one-off. Pure. */
export const oneOffKey = (shipmentId: string, product: string) => `oneoff-price:${shipmentId}:${product.trim().toLowerCase()}`

/**
 * Where the newest invoice for a product charged something other than the
 * price list. Brandon, 30 Sept 2026, wanted the sheet on "what mouse most
 * recently has"; the price list is that, since every invoice reads it, but a
 * price named for one order (Grandpa's Boy Belts at $80 and $90 on #2644,
 * against $130) is a deal, not a new price, so it is shown to a person to
 * decide rather than copied onto the list. Once someone marks it a one-off
 * (a Note under oneOffKey, which Mouse reads too) it is not shown again. Line totals are divided back to a
 * unit price; lines with no price or a zero are skipped. Pure.
 */
export function chargedDifferently(
  products: Array<{ name: string; wholesalePriceCents: number | null; variants: Array<{ wholesalePriceCents: number | null }> }>,
  shipments: Array<{ id: string; sentAt: Date; invoiceName: string | null; account: string; lines: Array<{ item: string; qty: number; wholesaleCents: number | null }> }>,
  oneOffs: ReadonlySet<string> = new Set(),
): ChargedDifferently[] {
  const out: ChargedDifferently[] = []
  const newestFirst = [...shipments].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
  for (const p of products) {
    const list = [...new Set([p.wholesalePriceCents, ...p.variants.map((v) => v.wholesalePriceCents)].filter((c): c is number => c != null))]
    if (!list.length) continue
    const name = p.name.trim().toLowerCase()
    for (const s of newestFirst) {
      const mine = s.lines.filter((l) => l.item.split(' / ')[0].trim().toLowerCase() === name && l.qty > 0 && l.wholesaleCents)
      if (!mine.length) continue
      const charged = [...new Set(mine.map((l) => Math.round(l.wholesaleCents! / l.qty)))].sort((a, b) => a - b)
      if (charged.some((c) => !list.includes(c)) && !oneOffs.has(oneOffKey(s.id, p.name))) out.push({ key: oneOffKey(s.id, p.name), product: p.name, charged, list: list.sort((a, b) => a - b), account: s.account, invoice: s.invoiceName, sentAt: s.sentAt })
      break
    }
  }
  return out
}

/** "$40" or, when variants differ, "$40 – $44". Pure. */
export function wholesaleText(l: Pick<LineSheetLine, 'wholesaleCents' | 'wholesaleMaxCents'>): string | null {
  if (l.wholesaleCents == null) return null
  return l.wholesaleMaxCents != null ? `${dollars(l.wholesaleCents)} – ${dollars(l.wholesaleMaxCents)}` : dollars(l.wholesaleCents)
}

/** A row prints only once it has a wholesale price and a description. Pure. */
export function onThePdf(l: Pick<LineSheetLine, 'wholesaleCents' | 'hidden' | 'description'>): boolean {
  return !l.hidden && l.wholesaleCents != null && !!l.description.trim()
}

/** Why a row is held off the PDF, for the Wholesale page. Pure. */
export function heldBackFor(l: Pick<LineSheetLine, 'wholesaleCents' | 'description'>): string[] {
  return [l.wholesaleCents == null && 'a wholesale price', !l.description.trim() && 'a description'].filter((x): x is string => !!x)
}

/** Shopify's CDN sends WebP to a browser; the PDF needs a JPEG, a bit larger than an invoice thumb. Pure. */
export function sheetPhoto(url: string | null): string | null {
  if (!url) return null
  if (!/^https:\/\/cdn\.shopify\.com\//.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}width=240&format=jpg`
}

export async function loadLineSheet(opts: { includeHidden?: boolean } = {}): Promise<{ meta: LineSheetMetaText | null; lines: LineSheetLine[] }> {
  // A failure here leaves the sheet as it was rather than blanking it.
  await addNewToLineSheet().catch((e) => console.error('line sheet: adding new products failed', e))
  const [meta, rows] = await Promise.all([
    db.lineSheetMeta.findUnique({ where: { id: 'main' } }),
    db.lineSheetRow.findMany({ where: opts.includeHidden ? {} : { hidden: false }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
  ])
  const ids = [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))]
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, wholesalePriceCents: true, retailPriceCents: true, shopifyDescription: true,
      variants: { select: { wholesalePriceCents: true, retailPriceCents: true, imageUrl: true, onHandQty: true, colorway: { select: { customerName: true } } } },
    },
  })
  const byId = new Map(products.map((p) => [p.id, p]))
  return {
    meta: meta ? { title: meta.title, tagline: meta.tagline, materials: meta.materials, press: meta.press, contact: meta.contact, footnote: meta.footnote } : null,
    lines: rows.map((r) => ({
      id: r.id, position: r.position, productId: r.productId, colorway: r.colorway, item: r.item, colorLabel: r.colorLabel,
      ownDescription: r.description, msrp: r.msrp, photoData: r.photoData ? Buffer.from(r.photoData) : null, sizing: r.sizing, minOrder: r.minOrder, commission: r.commission,
      availability: r.availability, hidden: r.hidden,
      ...resolveRow(r, r.productId ? byId.get(r.productId) ?? null : null),
    })),
  }
}

const INK = '#14181A'
const MUTED = '#6A736F'
const RULE = '#DEDFDB'
const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 30, fontSize: 7.5, fontFamily: 'PTSerif', color: INK },
  logo: { width: 200, height: 200 / WORDMARK_RATIO },
  title: { marginTop: 8, fontSize: 12, fontStyle: 'italic', fontWeight: 'bold' },
  tagline: { marginTop: 4, fontSize: 8.5 },
  materials: { marginTop: 2, fontSize: 8, color: MUTED },
  thead: { flexDirection: 'row', marginTop: 14, borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4 },
  th: { fontSize: 6.5, letterSpacing: 0.4, color: MUTED, paddingRight: 5 },
  tr: { flexDirection: 'row', alignItems: 'flex-start', borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 5 },
  td: { paddingRight: 5 },
  photo: { width: 48, height: 60, objectFit: 'cover', borderRadius: 2 },
  noPhoto: { width: 48, height: 60, backgroundColor: '#F0F0EC', borderRadius: 2 },
  bold: { fontWeight: 'bold' },
  foot: { marginTop: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: INK },
  footHead: { fontSize: 9, fontStyle: 'italic', fontWeight: 'bold', marginBottom: 4 },
  footText: { fontSize: 7.5, lineHeight: 1.4, marginBottom: 4 },
  pageNo: { position: 'absolute', bottom: 18, left: 30, right: 30, fontSize: 6.5, color: MUTED, flexDirection: 'row', justifyContent: 'space-between' },
})

// Widths add up to the page's 732pt of room (landscape Letter less margins).
const COLS: Array<{ key: string; label: string; w: number }> = [
  { key: 'photo', label: 'IMAGE', w: 56 },
  { key: 'item', label: 'ITEM', w: 72 },
  { key: 'color', label: 'COLOR / VARIANT', w: 64 },
  { key: 'desc', label: 'DESCRIPTION', w: 182 },
  { key: 'ws', label: 'WHOLESALE', w: 50 },
  { key: 'msrp', label: 'SUGGESTED RETAIL', w: 62 },
  { key: 'size', label: 'SIZING', w: 60 },
  { key: 'moq', label: 'MIN. ORDER', w: 64 },
  { key: 'comm', label: 'COMMISSION', w: 54 },
  { key: 'avail', label: 'AVAILABILITY', w: 68 },
]
const w = (key: string) => ({ width: COLS.find((c) => c.key === key)!.w })

/** The row above says the same thing: print a ditto mark, as the January sheet did. Pure. */
export function ditto(prev: string | undefined, cur: string): string {
  return prev !== undefined && prev.trim() && prev.trim() === cur.trim() ? '"' : cur
}

export function LineSheetDoc({ meta, lines, asOf }: { meta: LineSheetMetaText; lines: LineSheetLine[]; asOf: Date }) {
  const date = asOf.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
  return (
    <Document title={meta.title} author="Cleo Camp">
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image takes no alt */}
        <Image src={wordmark()} style={styles.logo} />
        <Text style={styles.title}>{meta.title}</Text>
        <Text style={styles.tagline}>{meta.tagline}</Text>
        <Text style={styles.materials}>{meta.materials}</Text>

        <View style={styles.thead} fixed>
          {COLS.map((c) => <Text key={c.key} style={[styles.th, { width: c.w }]}>{c.label}</Text>)}
        </View>
        {lines.map((l, i) => (
          <View key={l.id} style={styles.tr} wrap={false}>
            <View style={[styles.td, w('photo')]}>
              {/* react-pdf's Image takes no alt. */}
              {l.photoData
                // eslint-disable-next-line jsx-a11y/alt-text
                ? <Image src={{ data: l.photoData, format: 'jpg' }} style={styles.photo} />
                // eslint-disable-next-line jsx-a11y/alt-text
                : l.photo ? <Image src={sheetPhoto(l.photo)!} style={styles.photo} /> : <View style={styles.noPhoto} />}
            </View>
            <Text style={[styles.td, w('item'), styles.bold]}>{l.item}</Text>
            <Text style={[styles.td, w('color')]}>{l.colorLabel}</Text>
            <Text style={[styles.td, w('desc')]}>{ditto(lines[i - 1]?.description, l.description)}</Text>
            <Text style={[styles.td, w('ws'), styles.bold]}>{wholesaleText(l) ?? '—'}</Text>
            <Text style={[styles.td, w('msrp')]}>{l.retail ?? '—'}</Text>
            <Text style={[styles.td, w('size')]}>{l.sizing || '—'}</Text>
            <Text style={[styles.td, w('moq')]}>{ditto(lines[i - 1]?.minOrder, l.minOrder) || '—'}</Text>
            <Text style={[styles.td, w('comm')]}>{l.commission || '—'}</Text>
            <Text style={[styles.td, w('avail')]}>{l.availability || '—'}</Text>
          </View>
        ))}

        <View style={styles.foot} wrap={false}>
          <Text style={styles.footHead}>Press &amp; Collaborations</Text>
          {meta.press.split(/\n\s*\n/).map((para, i) => <Text key={i} style={styles.footText}>{para.trim()}</Text>)}
          <Text style={[styles.footText, { marginTop: 4 }]}>{meta.contact}</Text>
          <Text style={[styles.footText, { color: MUTED }]}>{meta.footnote}</Text>
        </View>

        <View style={styles.pageNo} fixed>
          <Text>Cleo Camp · Wholesale line sheet · Prices as of {date}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function renderLineSheetPdf(asOf = new Date()): Promise<Buffer | null> {
  const { meta, lines: all } = await loadLineSheet()
  // Nothing goes to a store without a price and a description. The Wholesale
  // page lists what is held back and why.
  const lines = all.filter(onThePdf)
  if (!meta || !lines.length) return null
  return renderToBuffer(<LineSheetDoc meta={meta} lines={lines} asOf={asOf} />)
}

/** "Cleo-Camp-Line-Sheet-2026-09-30.pdf", dated in Los Angeles. Pure. */
export function lineSheetFileName(asOf = new Date()): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(asOf)
  return `Cleo-Camp-Line-Sheet-${d}.pdf`
}
