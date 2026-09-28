import path from 'node:path'
import { Document, Page, Text, View, Image, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { shopifyGraphQL } from '@/lib/integrations/shopify'
import { db } from '@/lib/db'

/**
 * A Shopify draft order as a PDF, for passing round inside the studio before
 * it is sent. Brandon, 28 Sept 2026: "Can Mouse do that as well so it can be
 * shared internally." Shopify has no download for a draft, so this reads the
 * draft as it stands now, edits made in Shopify included, and draws it the
 * way lib/po-pdf.tsx draws a purchase order. It is stamped DRAFT while the
 * draft is open, because it is not what the store has been sent.
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

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: 'PTSerif', color: '#14181A' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  wordmark: { fontSize: 20, fontStyle: 'italic', fontWeight: 'bold' },
  sub: { marginTop: 3, fontSize: 8, letterSpacing: 1, color: '#6A736F' },
  stamp: { borderWidth: 1, borderColor: '#C0306A', color: '#C0306A', fontSize: 8, letterSpacing: 1, paddingVertical: 3, paddingHorizontal: 6 },
  muted: { color: '#6A736F' },
  addrLabel: { fontSize: 8, letterSpacing: 1, color: '#6A736F', marginBottom: 4, marginTop: 24 },
  table: { marginTop: 20 },
  thead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#14181A', paddingBottom: 5 },
  th: { fontSize: 7, letterSpacing: 1, color: '#6A736F' },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#DEDFDB', paddingVertical: 6 },
  item: { flex: 5, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  thumb: { width: 30, height: 30, borderRadius: 2, objectFit: 'cover' },
  num: { flex: 1, textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 5 },
  grand: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#14181A', fontWeight: 'bold' },
  note: { marginTop: 28, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#DEDFDB', fontSize: 9, color: '#5C6663' },
})

type Money = { shopMoney: { amount: string } }
type Addr = { company: string | null; name: string | null; address1: string | null; address2: string | null; city: string | null; provinceCode: string | null; zip: string | null } | null
export type DraftForPdf = {
  name: string
  /** Once sent, the order it became: the invoice number the customer sees. */
  order?: { name: string } | null
  status: string
  createdAt: string
  email: string | null
  /** Not read from Shopify (the app has no read_customers); the address carries the name. */
  customer?: { displayName: string } | null
  billingAddress: Addr
  shippingAddress: Addr
  shippingLine: { title: string } | null
  lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number; originalUnitPriceSet: Money; originalTotalSet: Money; image: { url: string } | null; photo?: string | null }> }
  subtotalPriceSet: Money
  totalShippingPriceSet: Money
  totalTaxSet: Money
  totalPriceSet: Money
  taxExempt: boolean
}

const usd = (m: Money | number) => `$${(typeof m === 'number' ? m : Number(m.shopMoney.amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Null when there is no such draft. `id` is the number in the Shopify admin link. */
export async function loadDraft(id: string): Promise<DraftForPdf | null> {
  if (!/^\d+$/.test(id)) return null
  const d = await shopifyGraphQL<{ draftOrder: DraftForPdf | null }>(
    `query($id: ID!) { draftOrder(id: $id) {
      name status createdAt email taxExempt order { name }
      billingAddress { company name address1 address2 city provinceCode zip }
      shippingAddress { company name address1 address2 city provinceCode zip }
      shippingLine { title }
      lineItems(first: 250) { nodes { title variantTitle quantity originalUnitPriceSet { shopMoney { amount } } originalTotalSet { shopMoney { amount } }
        image { url(transform: { maxWidth: 160, maxHeight: 160, preferredContentType: JPG }) } } }
      subtotalPriceSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } }
    } }`,
    { id: `gid://shopify/DraftOrder/${id}` },
  )
  if (!d.draftOrder) return null
  // A line that leaves stock alone is a plain line with no product behind
  // it in Shopify, so Shopify has no photo for it. Its title is the label
  // Mouse built from our own catalogue, which does have the photo — the same
  // one a purchase order shows.
  const missing = d.draftOrder.lineItems.nodes.filter((l) => !l.image)
  const ours = missing.length ? await catalogPhotos() : new Map<string, string>()
  for (const l of d.draftOrder.lineItems.nodes) l.photo = l.image?.url ?? jpegThumb(ours.get(l.title.trim().toLowerCase()) ?? null)
  return d.draftOrder
}

/** Our catalogue's photo for each line label ("Cleo Tee / Shell / 1"). */
export async function catalogPhotos(): Promise<Map<string, string>> {
  const vs = await db.productVariant.findMany({
    where: { imageUrl: { not: null } },
    select: { size: true, imageUrl: true, product: { select: { name: true } }, colorway: { select: { customerName: true } } },
  })
  const m = new Map<string, string>()
  for (const v of vs) m.set([v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ').toLowerCase(), v.imageUrl!)
  return m
}

/** Shopify's CDN sends WebP to a browser; the PDF needs a small JPEG. Pure. */
export function jpegThumb(url: string | null): string | null {
  if (!url) return null
  if (!/^https:\/\/cdn\.shopify\.com\//.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}width=160&format=jpg`
}

/** The lines of an address as it prints, without repeating the company as a name. Pure. */
export function addressBlock(a: Addr, fallbackName: string | null): string[] {
  const who = a?.company || fallbackName
  return [
    who,
    a?.name && a.name !== who ? a.name : null,
    a?.address1,
    a?.address2,
    a?.city ? `${a.city}${a.provinceCode ? `, ${a.provinceCode}` : ''}${a.zip ? ` ${a.zip}` : ''}` : null,
  ].filter((l): l is string => !!l)
}

export function DraftDoc({ d }: { d: DraftForPdf }) {
  const open = d.status !== 'COMPLETED'
  const date = new Date(d.createdAt).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', day: 'numeric', month: 'long', year: 'numeric' })
  const billTo = addressBlock(d.billingAddress ?? d.shippingAddress, d.customer?.displayName ?? null)
  const units = d.lineItems.nodes.reduce((n, l) => n + l.quantity, 0)
  const shipping = Number(d.totalShippingPriceSet.shopMoney.amount)
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.row}>
          <View>
            <Text style={styles.wordmark}>Cleo Camp</Text>
            <Text style={styles.sub}>INVOICE {open ? '— DRAFT' : ''}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {open ? <Text style={styles.stamp}>DRAFT · NOT SENT</Text> : null}
            <Text style={{ marginTop: 8, fontWeight: 'bold' }}>{d.order?.name ?? d.name}</Text>
            <Text style={styles.muted}>{date}</Text>
          </View>
        </View>

        <Text style={styles.addrLabel}>BILL TO</Text>
        {billTo.map((l, i) => <Text key={i} style={i === 0 ? { fontWeight: 'bold' } : undefined}>{l}</Text>)}
        {d.email ? <Text style={styles.muted}>{d.email}</Text> : null}

        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, { flex: 5 }]}>ITEM</Text>
            <Text style={[styles.th, styles.num]}>QTY</Text>
            <Text style={[styles.th, styles.num]}>UNIT</Text>
            <Text style={[styles.th, styles.num]}>AMOUNT</Text>
          </View>
          {d.lineItems.nodes.map((l, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <View style={styles.item}>
                {l.photo ? <Image src={l.photo} style={styles.thumb} /> : null}
                <Text>{l.title}{l.variantTitle ? ` — ${l.variantTitle}` : ''}</Text>
              </View>
              <Text style={styles.num}>{l.quantity}</Text>
              <Text style={styles.num}>{usd(l.originalUnitPriceSet)}</Text>
              <Text style={styles.num}>{usd(l.originalTotalSet)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}><Text style={{ width: 170 }}>Subtotal ({units} pieces)</Text><Text style={{ width: 90, textAlign: 'right' }}>{usd(d.subtotalPriceSet)}</Text></View>
        {shipping || d.shippingLine ? (
          <View style={styles.totalRow}><Text style={{ width: 170 }}>{d.shippingLine?.title ?? 'Shipping'}</Text><Text style={{ width: 90, textAlign: 'right' }}>{usd(shipping)}</Text></View>
        ) : null}
        <View style={styles.totalRow}><Text style={{ width: 170 }}>{d.taxExempt ? 'Sales tax (wholesale, none)' : 'Sales tax'}</Text><Text style={{ width: 90, textAlign: 'right' }}>{usd(d.totalTaxSet)}</Text></View>
        <View style={styles.grand}><Text style={{ width: 170 }}>Total</Text><Text style={{ width: 90, textAlign: 'right' }}>{usd(d.totalPriceSet)}</Text></View>

        {open ? <Text style={styles.note}>Copy of Shopify draft order {d.name} for internal review. Nothing has been sent to the customer.</Text> : null}
      </Page>
    </Document>
  )
}

export async function renderDraftPdf(id: string): Promise<{ name: string; pdf: Buffer } | null> {
  const d = await loadDraft(id)
  if (!d) return null
  return { name: d.order?.name ?? d.name, pdf: await renderToBuffer(<DraftDoc d={d} />) }
}
