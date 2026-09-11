import { poAmounts, poLineAmount, poUnitTotals } from '@/lib/po'
import path from 'node:path'
import { Document, Page, Text, View, Image, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { db } from '@/lib/db'
import { asDocLanguage, confirmSentence, formatDate, label, type DocLanguage } from '@/lib/po-strings'

/**
 * The same purchase order as app/po/[poNumber]/page.tsx, as an actual PDF
 * file rather than a page someone prints from their browser. Used by the
 * download link on that page and by send_purchase_order, which has to
 * attach real bytes — a vendor has no login for our app, so a link in an
 * email to them is a dead end.
 *
 * Deliberately not a screenshot of the HTML page: that would mean running a
 * full headless browser on every download, for a document simple enough
 * that a second, direct rendering is the lighter and more reliable path.
 * Keep the two in sync by hand if the layout changes.
 *
 * The base-14 PDF font names ('Helvetica' etc.) are NOT embedded by
 * react-pdf and render as blank glyphs in real viewers (Chrome, poppler) —
 * only pdftotext's text-extraction made it look like they worked. Found by
 * actually opening a generated PDF rather than trusting a clean build.
 *
 * Registering a real font fixes that, but the first fix (fetching it from
 * our own deployment over HTTP) 500'd in production only: Vercel's own
 * deployment-protection blocks a request to a deployment's canonical URL,
 * even the deployment's own function calling itself. Reading the file
 * straight off disk sidesteps that layer entirely — see the
 * outputFileTracingIncludes entry in next.config.ts, which is what gets
 * these bytes into the deployed function in the first place.
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

// Brandon, 4 Sept 2026: the address column split "Los Angeles" as
// "Los Ange-les" across two lines. That's react-pdf's own default
// hyphenation kicking in on a narrow column — this turns it off entirely,
// so a word that doesn't fit wraps whole onto the next line instead.
Font.registerHyphenationCallback((word) => [word])

const money = (c: number) =>
  '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: 'PTSerif', color: '#14181A' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  wordmark: { fontSize: 20, fontStyle: 'italic', fontWeight: 'bold' },
  sub: { marginTop: 3, fontSize: 8, letterSpacing: 1, color: '#6A736F' },
  docTitle: { fontSize: 13, letterSpacing: 1 },
  muted: { color: '#6A736F' },
  hr: { marginTop: 14, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#14181A' },
  addrBlock: { flex: 1 },
  addrLabel: { fontSize: 8, letterSpacing: 1, color: '#6A736F', marginBottom: 4 },
  addrLine: { marginBottom: 1 },
  table: { marginTop: 20 },
  thead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#14181A', paddingBottom: 5 },
  th: { fontSize: 7, letterSpacing: 1, color: '#6A736F' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#DEDFDB', paddingVertical: 7, alignItems: 'flex-start' },
  tdItem: { flex: 5, flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingRight: 6 },
  thumb: { width: 26, height: 26, borderRadius: 2 },
  tdQty: { flex: 1, textAlign: 'right' },
  tdUnit: { flex: 1, textAlign: 'right' },
  tdPrice: { flex: 1, textAlign: 'right' },
  tdAmount: { flex: 1, textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#14181A' },
  notes: { marginTop: 28, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#DEDFDB', fontSize: 9, color: '#5C6663' },
  footer: { marginTop: 20, fontSize: 8.5, color: '#8B9491' },
})

export type PoForPdf = NonNullable<Awaited<ReturnType<typeof loadPo>>>

export async function loadPo(poNumber: string) {
  return db.purchaseOrder.findFirst({
    where: { poNumber },
    include: {
      vendor: true, forProduct: true,
      lines: { orderBy: { id: 'asc' }, include: { component: true, productVariant: { include: { product: true, colorway: true } } } },
    },
  })
}

export type DocContent = { billTo: string[]; confirmLine: string; contactLines: string[] }

export function PurchaseOrderDoc({ po, content, clean = false }: { po: PoForPdf; content: DocContent; clean?: boolean }) {
  const lang: DocLanguage = asDocLanguage(po.language)
  const t = (k: Parameters<typeof label>[1]) => label(lang, k)
  const total = poAmounts(po.lines)
  const unitTotals = poUnitTotals(po.lines)
  const date = formatDate(lang, po.orderedAt ?? po.createdAt)

  // See the same fix, and why, in app/po/[poNumber]/page.tsx: notes is
  // exactly what was actually written, nothing synthesized per line.
  const notes: string[] = po.notes ? [po.notes] : []

  const lineLabel = (l: (typeof po.lines)[number]) => {
    if (l.component) {
      return `${l.component.vendorSku ? `${t('style')} ${l.component.vendorSku} — ` : ''}${l.component.vendorDescription ?? l.component.name}`
    }
    // A line describing something the catalogue does not hold yet — a new
    // colour, a sample size. Its text is the whole label; there is no sku or
    // colourway to dress it up with. See lib/po.ts:poLineLabel.
    const v = l.productVariant
    if (!v) return l.description ?? ''
    return (
      `${v.sku ? `${t('style')} ${v.sku} — ` : ''}${v.product.name}` +
      `${v.colorway ? ` — ${v.colorway.customerName}` : ''}` +
      `${v.size ? ` / ${v.size}` : ''}`
    )
  }

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.row}>
          <View>
            <Text style={styles.wordmark}>Cleo</Text>
            <Text style={styles.sub}>CLEO COUTURE LLC</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.docTitle}>{t('purchaseOrder')}</Text>
            <Text style={{ marginTop: 6 }}><Text style={styles.muted}>{t('no')} </Text>{po.poNumber}</Text>
            {po.forProduct ? <Text><Text style={styles.muted}>{t('for')} </Text>{po.forProduct.name}</Text> : null}
            <Text><Text style={styles.muted}>{t('date')} </Text>{date}</Text>
            {po.expectedAt ? (
              <Text>
                <Text style={styles.muted}>{t('expected')} </Text>
                {formatDate(lang, po.expectedAt, 'UTC')}
              </Text>
            ) : null}
            {po.paymentTerms ? <Text><Text style={styles.muted}>{t('terms')} </Text>{po.paymentTerms}</Text> : null}
            {/* Brandon, 11 Sept: "no more draft on the PO -- too confusing,
                it never gets taken off if i need to send externally." Never
                shown here now, regardless of status — this is the PDF a
                vendor actually receives, whether through send_purchase_order
                or Brandon downloading and sending it himself, and there is
                no path from here back to "clean" once it has left the
                building. The in-app HTML page still shows DRAFT — that view
                is internal-only and the status is real, useful information
                there. `clean`/`asSent` no longer change anything on this
                line; kept as parameters since other call sites still pass
                them and removing the plumbing is a separate, unrelated
                change from what was actually asked for here. */}
          </View>
        </View>

        <View style={styles.hr} />

        <View style={styles.row}>
          <View style={styles.addrBlock}>
            <Text style={styles.addrLabel}>{t('vendor')}</Text>
            {/* Registered name, not Cleo's own name for them — see the same
                fix in app/po/[poNumber]/page.tsx. */}
            <Text style={styles.addrLine}>{po.vendor.legalName ?? po.vendor.name}</Text>
            {po.vendor.contactName ? <Text style={styles.addrLine}>{t('attn')} {po.vendor.contactName}</Text> : null}
            {po.vendor.address ? <Text style={styles.addrLine}>{po.vendor.address}</Text> : null}
          </View>
          <View style={styles.addrBlock}>
            <Text style={styles.addrLabel}>{t('address')}</Text>
            {(po.deliverTo ?? '').split('\n').filter(Boolean).map((l, i) => <Text key={i} style={styles.addrLine}>{l}</Text>)}
          </View>
          <View style={styles.addrBlock}>
            <Text style={styles.addrLabel}>{t('billTo')}</Text>
            {content.billTo.map((l, i) => <Text key={i} style={styles.addrLine}>{l}</Text>)}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, { flex: 5 }]}>{t('item')}</Text>
            <Text style={[styles.th, styles.tdQty]}>{t('qty')}</Text>
            <Text style={[styles.th, styles.tdUnit]}>{t('unit')}</Text>
            <Text style={[styles.th, styles.tdPrice]}>{t('price')}</Text>
            <Text style={[styles.th, styles.tdAmount]}>{t('amount')}</Text>
          </View>
          {po.lines.map((l) => (
            <View key={l.id} style={styles.tr}>
              <View style={styles.tdItem}>
                {l.productVariant?.imageUrl ? <Image src={l.productVariant.imageUrl} style={styles.thumb} /> : null}
                <Text>{lineLabel(l)}</Text>
              </View>
              <Text style={styles.tdQty}>{Number(l.qtyOrdered).toLocaleString()}</Text>
              <Text style={styles.tdUnit}>{l.unit}</Text>
              <Text style={styles.tdPrice}>{l.unitCostCents !== null ? money(l.unitCostCents) : '—'}</Text>
              <Text style={styles.tdAmount}>{l.unitCostCents === null ? '—' : money(poLineAmount(Number(l.qtyOrdered), l.unitCostCents)!)}</Text>
            </View>
          ))}
        </View>

        {unitTotals.map((u, i) => (
          <View key={i} style={styles.totalRow}>
            <Text style={{ width: 100 }}>{t('totalUnits')}</Text>
            <Text style={{ width: 90, textAlign: 'right' }}>
              {u.qty.toLocaleString()} {u.unit}
            </Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={{ width: 100 }}>{t(total.incomplete ? 'knownSubtotal' : 'total')}</Text>
          <Text style={{ width: 90, textAlign: 'right' }}>{money(total.knownCents)}</Text>
        </View>

        {notes.length ? (
          <View style={styles.notes}>
            <Text style={styles.addrLabel}>{t('notes')}</Text>
            {notes.map((n, i) => <Text key={i} style={{ marginBottom: 3 }}>{'• ' + n}</Text>)}
          </View>
        ) : null}

        <Text style={styles.footer}>
          {[content.confirmLine, ...content.contactLines].filter(Boolean).join('\n')}
        </Text>
      </Page>
    </Document>
  )
}

/** Null if the PO doesn't exist. */
/**
 * @param opts.asSent / opts.clean No longer change the rendered PDF as of
 * 11 Sept 2026 — see the comment on the draft-stamp line inside
 * PurchaseOrderDoc. Originally `asSent` rendered the document as SENT even
 * though the row still said DRAFT: send_purchase_order writes the real
 * status only after a successful send (so a failed send leaves the order
 * untouched rather than marked sent when it isn't), which meant the file in
 * the vendor's hands was built while the row still said DRAFT — RichLine
 * received PO 2361 that way on 9 Sept 2026. Brandon then asked for the
 * stamp gone from the PDF entirely, unconditionally, which is a strictly
 * bigger fix that makes this flag redundant for that purpose. Kept as a
 * parameter, not removed, since send_purchase_order and the export path
 * still pass it — deleting the plumbing is a separate cleanup from what was
 * actually asked for.
 */
export async function renderPurchaseOrderPdf(
  poNumber: string,
  opts: { asSent?: boolean; clean?: boolean } = {},
): Promise<Buffer | null> {
  const [po, defaults] = await Promise.all([
    loadPo(poNumber),
    db.documentDefaults.findUnique({ where: { id: 'singleton' } }),
  ])
  if (!po) return null
  return renderPoSnapshot(po, defaults, { clean: opts.clean || opts.asSent })
}

export async function renderPoSnapshot(
  po: PoForPdf,
  defaults: { billToLines: string; confirmLine: string; confirmLineEs?: string | null; contactLines: string } | null,
  opts: { clean?: boolean } = {},
): Promise<Buffer> {
  const content: DocContent = {
    billTo: (defaults?.billToLines ?? '').split('\n').filter(Boolean),
    // Spanish is a stored sentence, not a render-time translation.
    confirmLine: confirmSentence(asDocLanguage(po.language), defaults?.confirmLine ?? '', defaults?.confirmLineEs),
    // A per-order override wins; almost nothing sets one.
    contactLines: (po.contactLines ?? defaults?.contactLines ?? '').split('\n').filter(Boolean),
  }
  return renderToBuffer(<PurchaseOrderDoc po={po} content={content} clean={opts.clean} />)
}
