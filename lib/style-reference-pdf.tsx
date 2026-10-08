import path from 'node:path'
import { Document, Page, Text, View, Image, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { wordmark, WORDMARK_RATIO } from '@/lib/brand'
import { howToRead, partnerReference } from '@/lib/style-reference'
import { sheetPhoto } from '@/lib/line-sheet'

/**
 * The style number reference (app/styles/page.tsx) as a PDF file a partner
 * can be sent. Same fonts and wordmark as the purchase orders; see
 * lib/po-pdf.tsx on why the font is read from disk.
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

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: 'PTSerif', color: '#14181A' },
  wordmark: { width: 120, height: 120 / WORDMARK_RATIO },
  sub: { marginTop: 6, fontSize: 8, letterSpacing: 1, color: '#6A736F' },
  hr: { marginTop: 14, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#14181A' },
  h2: { fontSize: 8, letterSpacing: 1, color: '#6A736F', marginBottom: 5 },
  cat: { marginTop: 14, fontSize: 8, letterSpacing: 1, color: '#6A736F', borderBottomWidth: 1, borderBottomColor: '#14181A', paddingBottom: 3 },
  style: { borderBottomWidth: 1, borderBottomColor: '#DEDFDB', paddingVertical: 5 },
  muted: { color: '#5C6663', fontSize: 9 },
  bullet: { marginBottom: 3 },
  codes: { marginTop: 6, color: '#5C6663', fontSize: 9 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  photo: { width: 54, height: 54, objectFit: 'cover', borderRadius: 2 },
  noPhoto: { width: 54, height: 54, backgroundColor: '#F1F1EE', borderRadius: 2 },
})

export async function renderStyleReferencePdf(): Promise<Buffer> {
  const { categories, example, categoryCodes, sizeCodes } = await partnerReference()
  return renderToBuffer(
    <Document title="Cleo Camp style numbers">
      <Page size="LETTER" style={s.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image takes no alt */}
        <Image src={wordmark()} style={s.wordmark} />
        <Text style={s.sub}>CLEO COUTURE LLC · STYLE NUMBERS</Text>
        <View style={s.hr} />
        <Text style={s.h2}>HOW TO READ A SKU</Text>
        {howToRead(example).map((l, i) => <Text key={i} style={s.bullet}>{'• ' + l}</Text>)}
        <Text style={s.codes}>{`Categories: ${categoryCodes.map((c) => `${c.code} ${c.name}`).join(' · ')}`}</Text>
        <Text style={s.codes}>{`Sizes: ${sizeCodes.map((c) => c.code === c.name ? c.code : `${c.code} ${c.name}`).join(' · ')}`}</Text>
        {categories.map((c) => (
          <View key={c.code}>
            <Text style={s.cat} minPresenceAhead={80}>{`${c.code} · ${c.name.toUpperCase()}`}</Text>
            {c.styles.map((st) => (
              <View key={st.number} style={[s.style, s.row]} wrap={false}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image takes no alt */}
                {st.photo ? <Image src={sheetPhoto(st.photo)!} style={s.photo} /> : <View style={s.noPhoto} />}
                <View style={{ flex: 1 }}>
                  <Text>{`${st.number}  ${st.name}${st.status === 'DEVELOPMENT' ? '  (in development)' : ''}`}</Text>
                  <Text style={s.muted}>{`Colours: ${st.colours.length ? st.colours.map((x) => `${x.code} ${x.name}`).join(' · ') : 'to be confirmed'}`}</Text>
                  <Text style={s.muted}>{`Sizes: ${st.sizes.length ? st.sizes.map((x) => `${x.code}${x.code === x.name ? '' : ` ${x.name}`}`).join(' · ') : 'to be confirmed'}`}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>,
  )
}
