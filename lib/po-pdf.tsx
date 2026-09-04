import path from 'node:path'
import { Document, Page, Text, View, Image, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { db } from '@/lib/db'

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

type PoForPdf = NonNullable<Awaited<ReturnType<typeof loadPo>>>

async function loadPo(poNumber: string) {
  return db.purchaseOrder.findFirst({
    where: { poNumber },
    include: {
      vendor: true, forProduct: true,
      lines: { include: { component: true, productVariant: { include: { product: true, colorway: true } } } },
    },
  })
}

function PurchaseOrderDoc({ po }: { po: PoForPdf }) {
  const total = po.lines.reduce((n, l) => n + Number(l.qtyOrdered) * (l.unitCostCents ?? 0), 0)
  const date = (po.orderedAt ?? po.createdAt).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric',
  })

  // See the same fix, and why, in app/po/[poNumber]/page.tsx: notes is
  // exactly what was actually written, nothing synthesized per line.
  const notes: string[] = po.notes ? [po.notes] : []

  const lineLabel = (l: (typeof po.lines)[number]) =>
    l.component
      ? `${l.component.vendorSku ? `Style ${l.component.vendorSku} — ` : ''}${l.component.vendorDescription ?? l.component.name}`
      : `${l.productVariant!.sku ? `Style ${l.productVariant!.sku} — ` : ''}${l.productVariant!.product.name}` +
        `${l.productVariant!.colorway ? ` — ${l.productVariant!.colorway.customerName}` : ''}` +
        `${l.productVariant!.size ? ` / ${l.productVariant!.size}` : ''}`

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.row}>
          <View>
            <Text style={styles.wordmark}>Cleo</Text>
            <Text style={styles.sub}>CLEO COUTURE LLC</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.docTitle}>PURCHASE ORDER</Text>
            <Text style={{ marginTop: 6 }}><Text style={styles.muted}>No. </Text>{po.poNumber}</Text>
            {po.forProduct ? <Text><Text style={styles.muted}>For </Text>{po.forProduct.name}</Text> : null}
            <Text><Text style={styles.muted}>Date </Text>{date}</Text>
            {po.expectedAt ? (
              <Text>
                <Text style={styles.muted}>Expected </Text>
                {po.expectedAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}
              </Text>
            ) : null}
            {po.paymentTerms ? <Text><Text style={styles.muted}>Terms </Text>{po.paymentTerms}</Text> : null}
            {po.status === 'DRAFT' ? <Text style={{ marginTop: 3, fontSize: 8, color: '#8C3A2B' }}>DRAFT — NOT SENT</Text> : null}
          </View>
        </View>

        <View style={styles.hr} />

        <View style={styles.row}>
          <View style={styles.addrBlock}>
            <Text style={styles.addrLabel}>VENDOR</Text>
            {/* Registered name, not Cleo's own name for them — see the same
                fix in app/po/[poNumber]/page.tsx. */}
            <Text style={styles.addrLine}>{po.vendor.legalName ?? po.vendor.name}</Text>
            {po.vendor.contactName ? <Text style={styles.addrLine}>Attn: {po.vendor.contactName}</Text> : null}
            {po.vendor.address ? <Text style={styles.addrLine}>{po.vendor.address}</Text> : null}
          </View>
          <View style={styles.addrBlock}>
            <Text style={styles.addrLabel}>ADDRESS</Text>
            {(po.deliverTo ?? '').split('\n').filter(Boolean).map((l, i) => <Text key={i} style={styles.addrLine}>{l}</Text>)}
          </View>
          <View style={styles.addrBlock}>
            <Text style={styles.addrLabel}>BILL TO</Text>
            <Text style={styles.addrLine}>Cleo Couture LLC</Text>
            <Text style={styles.addrLine}>1667 North Main St</Text>
            <Text style={styles.addrLine}>Los Angeles, CA 90012</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, { flex: 5 }]}>ITEM</Text>
            <Text style={[styles.th, styles.tdQty]}>QTY</Text>
            <Text style={[styles.th, styles.tdUnit]}>UNIT</Text>
            <Text style={[styles.th, styles.tdPrice]}>PRICE</Text>
            <Text style={[styles.th, styles.tdAmount]}>AMOUNT</Text>
          </View>
          {po.lines.map((l) => (
            <View key={l.id} style={styles.tr}>
              <View style={styles.tdItem}>
                {l.productVariant?.imageUrl ? <Image src={l.productVariant.imageUrl} style={styles.thumb} /> : null}
                <Text>{lineLabel(l)}</Text>
              </View>
              <Text style={styles.tdQty}>{Number(l.qtyOrdered).toLocaleString()}</Text>
              <Text style={styles.tdUnit}>{l.unit}</Text>
              <Text style={styles.tdPrice}>{l.unitCostCents ? money(l.unitCostCents) : '—'}</Text>
              <Text style={styles.tdAmount}>{money(Number(l.qtyOrdered) * (l.unitCostCents ?? 0))}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={{ width: 100 }}>Total</Text>
          <Text style={{ width: 90, textAlign: 'right' }}>{money(total)}</Text>
        </View>

        {notes.length ? (
          <View style={styles.notes}>
            <Text style={styles.addrLabel}>NOTES</Text>
            {notes.map((n, i) => <Text key={i} style={{ marginBottom: 3 }}>{'• ' + n}</Text>)}
          </View>
        ) : null}

        <Text style={styles.footer}>
          Please confirm receipt and expected ship date.{'\n'}
          Studio Mouse · mouse@send.cleocamp.com{'\n'}
          Brandon Camp · brandon@cleocamp.com · 310-622-3898
        </Text>
      </Page>
    </Document>
  )
}

/** Null if the PO doesn't exist. */
export async function renderPurchaseOrderPdf(poNumber: string): Promise<Buffer | null> {
  const po = await loadPo(poNumber)
  if (!po) return null
  return renderToBuffer(<PurchaseOrderDoc po={po} />)
}
