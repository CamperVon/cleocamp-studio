/**
 * Purchase-order labels in English, Spanish and Italian.
 *
 * Lorena and Santos and Empire are Los Angeles cut-and-sew shops. The person
 * who reads the order in the office and the person cutting from it on the
 * floor are not always the same people, which is why "both" exists as well as
 * "es" — a bilingual document is one document everyone can act on, rather than
 * two that can drift apart.
 *
 * What this file translates is CHROME: the fixed furniture of the document,
 * the same words on every order ever printed. It does not translate CONTENT —
 * notes, payment terms, line descriptions, units, addresses. That is a
 * deliberate line, not an omission. Chrome is a closed set that can be got
 * right once and checked; content is written fresh each time, and a machine
 * translation of "50% on order, balance on delivery" that comes out subtly
 * wrong is a real invoice dispute with a real factory. Content is written in
 * the document's language when it is written — see the prompt rule, and
 * DocumentDefaults.confirmLineEs for the one standing sentence.
 *
 * Product and colourway names are also content, and deliberately do NOT
 * translate: "Cleo Bag" and "Earthy Chocolate Suede" are what the thing is
 * called, in any language, and a factory matching a style number against a
 * translated name would be matching against something that exists nowhere.
 *
 * Italian arrived 21 Sept 2026 for Cinturificiog, who make the Boy Belt.
 * Brandon: "I need our belt POs to be in both English and Italian." Adding it
 * meant retiring the name "both", which meant English and Spanish back when
 * those were the only two — a name that could only ever describe one pair.
 * It is still accepted and read as en_es, so nothing stored has to change.
 */

export type DocLanguage = 'en' | 'es' | 'it' | 'en_es' | 'en_it'

/** Languages a document can be written in on its own. */
type Single = 'en' | 'es' | 'it'

/**
 * A bilingual document is its two languages, in print order. English leads in
 * both pairs because the order is written here and read there.
 */
const PAIRS: Record<'en_es' | 'en_it', [Single, Single]> = {
  en_es: ['en', 'es'],
  en_it: ['en', 'it'],
}

const isPair = (l: DocLanguage): l is 'en_es' | 'en_it' => l === 'en_es' || l === 'en_it'

export function asDocLanguage(v: string | null | undefined): DocLanguage {
  // "both" is what en_es was called before Italian existed. Every vendor and
  // order already storing it keeps working untouched.
  if (v === 'both' || v === 'en_es') return 'en_es'
  if (v === 'en_it') return 'en_it'
  if (v === 'es' || v === 'it') return v
  return 'en'
}

type Key =
  | 'purchaseOrder' | 'no' | 'for' | 'date' | 'expected' | 'terms' | 'draft'
  | 'vendor' | 'attn' | 'address' | 'billTo'
  | 'item' | 'qty' | 'unit' | 'price' | 'amount' | 'total' | 'knownSubtotal' | 'totalUnits' | 'notes' | 'style'

const EN: Record<Key, string> = {
  purchaseOrder: 'PURCHASE ORDER', no: 'No.', for: 'For', date: 'Date',
  expected: 'Expected', terms: 'Terms', draft: 'DRAFT — NOT SENT',
  vendor: 'VENDOR', attn: 'Attn:', address: 'ADDRESS', billTo: 'BILL TO',
  item: 'ITEM', qty: 'QTY', unit: 'UNIT', price: 'PRICE', amount: 'AMOUNT',
  total: 'Total', knownSubtotal: 'Known subtotal', totalUnits: 'Total units', notes: 'NOTES', style: 'Style',
}

const ES: Record<Key, string> = {
  purchaseOrder: 'ORDEN DE COMPRA', no: 'N.º', for: 'Para', date: 'Fecha',
  expected: 'Entrega prevista', terms: 'Condiciones', draft: 'BORRADOR — NO ENVIADO',
  vendor: 'PROVEEDOR', attn: 'Atn:', address: 'DIRECCIÓN', billTo: 'FACTURAR A',
  item: 'ARTÍCULO', qty: 'CANT.', unit: 'UNIDAD', price: 'PRECIO', amount: 'IMPORTE',
  total: 'Total', knownSubtotal: 'Subtotal conocido', totalUnits: 'Unidades totales', notes: 'NOTAS', style: 'Estilo',
}

const IT: Record<Key, string> = {
  purchaseOrder: 'ORDINE DI ACQUISTO', no: 'N.', for: 'Per', date: 'Data',
  expected: 'Consegna prevista', terms: 'Condizioni', draft: 'BOZZA — NON INVIATO',
  vendor: 'FORNITORE', attn: 'Att.ne:', address: 'INDIRIZZO', billTo: 'FATTURARE A',
  item: 'ARTICOLO', qty: 'Q.TÀ', unit: 'UNITÀ', price: 'PREZZO', amount: 'IMPORTO',
  total: 'Totale', knownSubtotal: 'Subtotale noto', totalUnits: 'Unità totali', notes: 'NOTE', style: 'Modello',
}

const DICT: Record<Single, Record<Key, string>> = { en: EN, es: ES, it: IT }

/** Which locale writes each language's dates. */
const LOCALE: Record<Single, string> = { en: 'en-US', es: 'es-MX', it: 'it-IT' }

/**
 * On a bilingual document, a few labels are not worth doubling: the two
 * versions are near-identical, and "Attn: / Atn: Lorena" reads as a typo
 * rather than as a courtesy. These print once.
 */
const BOTH_SINGLE: Partial<Record<Key, string>> = { attn: 'Attn:' }

/**
 * A label in the document's language. For "both", the two are joined with a
 * slash — except where they are already the same word, which would otherwise
 * print "Total / Total", and except the near-identical ones above.
 */
export function label(lang: DocLanguage, key: Key): string {
  if (!isPair(lang)) return DICT[lang][key]
  const single = BOTH_SINGLE[key]
  if (single) return single
  const [a, b] = PAIRS[lang]
  const left = DICT[a][key]
  const right = DICT[b][key]
  return left === right ? left : `${left} / ${right}`
}

/**
 * Dates, in the document's language.
 *
 * Spanish writes "15 de septiembre de 2026" and Italian "15 settembre 2026" —
 * different shapes, not just different words, which is exactly the sort of
 * thing a hand-built date string gets wrong. Intl knows them. Bilingual
 * documents print both, because a date is the field most likely to be misread
 * and the most expensive to misread.
 */
export function formatDate(lang: DocLanguage, d: Date, timeZone = 'America/Los_Angeles'): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone, month: 'long', day: 'numeric', year: 'numeric' }
  const write = (l: Single) => d.toLocaleDateString(LOCALE[l], opts)
  if (!isPair(lang)) return write(lang)
  const [a, b] = PAIRS[lang]
  return `${write(a)} / ${write(b)}`
}

/**
 * The standing confirm sentence, in the document's language.
 *
 * A bilingual document prints both, on their own lines — this is the sentence
 * telling a vendor what to do next, so on a document meant for two sets of
 * readers it needs to reach both of them. Falls back to English whenever the
 * other sentence has not been written: an English sentence a vendor can puzzle
 * out beats a machine-translated instruction they act on wrongly. That is the
 * same line this file draws everywhere — chrome translates, content does not.
 */
export function confirmSentence(
  lang: DocLanguage,
  en: string,
  translations: { es?: string | null; it?: string | null },
): string {
  const other = (l: Single) => (l === 'es' ? translations.es : l === 'it' ? translations.it : en)
  if (lang === 'en') return en
  if (!isPair(lang)) return other(lang) || en
  const [, second] = PAIRS[lang]
  const tail = other(second)
  if (!tail || tail === en) return en
  return `${en}\n${tail}`
}
