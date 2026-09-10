/**
 * Purchase-order labels in English and Spanish.
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
 */

export type DocLanguage = 'en' | 'es' | 'both'

export function asDocLanguage(v: string | null | undefined): DocLanguage {
  return v === 'es' || v === 'both' ? v : 'en'
}

type Key =
  | 'purchaseOrder' | 'no' | 'for' | 'date' | 'expected' | 'terms' | 'draft'
  | 'vendor' | 'attn' | 'address' | 'billTo'
  | 'item' | 'qty' | 'unit' | 'price' | 'amount' | 'total' | 'knownSubtotal' | 'notes' | 'style'

const EN: Record<Key, string> = {
  purchaseOrder: 'PURCHASE ORDER', no: 'No.', for: 'For', date: 'Date',
  expected: 'Expected', terms: 'Terms', draft: 'DRAFT — NOT SENT',
  vendor: 'VENDOR', attn: 'Attn:', address: 'ADDRESS', billTo: 'BILL TO',
  item: 'ITEM', qty: 'QTY', unit: 'UNIT', price: 'PRICE', amount: 'AMOUNT',
  total: 'Total', knownSubtotal: 'Known subtotal', notes: 'NOTES', style: 'Style',
}

const ES: Record<Key, string> = {
  purchaseOrder: 'ORDEN DE COMPRA', no: 'N.º', for: 'Para', date: 'Fecha',
  expected: 'Entrega prevista', terms: 'Condiciones', draft: 'BORRADOR — NO ENVIADO',
  vendor: 'PROVEEDOR', attn: 'Atn:', address: 'DIRECCIÓN', billTo: 'FACTURAR A',
  item: 'ARTÍCULO', qty: 'CANT.', unit: 'UNIDAD', price: 'PRECIO', amount: 'IMPORTE',
  total: 'Total', knownSubtotal: 'Subtotal conocido', notes: 'NOTAS', style: 'Estilo',
}

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
  if (lang === 'en') return EN[key]
  if (lang === 'es') return ES[key]
  const single = BOTH_SINGLE[key]
  if (single) return single
  return EN[key] === ES[key] ? EN[key] : `${EN[key]} / ${ES[key]}`
}

/**
 * Dates, in the document's language.
 *
 * Spanish writes "15 de septiembre de 2026" — a different shape, not just
 * different words, which is exactly the sort of thing a hand-built date string
 * gets wrong. Intl knows it. Bilingual documents print the English date and
 * the Spanish one, because a date is the field most likely to be misread and
 * the most expensive to misread.
 */
export function formatDate(lang: DocLanguage, d: Date, timeZone = 'America/Los_Angeles'): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone, month: 'long', day: 'numeric', year: 'numeric' }
  const en = d.toLocaleDateString('en-US', opts)
  const es = d.toLocaleDateString('es-MX', opts)
  if (lang === 'en') return en
  if (lang === 'es') return es
  return `${en} / ${es}`
}

/**
 * The standing confirm sentence, in the document's language.
 *
 * A bilingual document prints both, on their own lines — this is the sentence
 * telling a vendor what to do next, so on a document meant for two sets of
 * readers it needs to reach both of them. Falls back to English whenever no
 * Spanish sentence has been written: an English sentence a vendor can puzzle
 * out beats a machine-translated instruction they act on wrongly.
 */
export function confirmSentence(lang: DocLanguage, en: string, es: string | null | undefined): string {
  if (lang === 'en' || !es) return en
  if (lang === 'es') return es
  return en === es ? en : `${en}\n${es}`
}
