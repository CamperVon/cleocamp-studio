import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asDocLanguage, label, formatDate, confirmSentence } from '../lib/po-strings'

// These run everywhere. The PDF test's text assertions need pdftotext, which
// is optional for contributors and absent in CI sandboxes — so on a machine
// without it that test proves only that bytes came out shaped like a PDF. The
// chrome itself is checked here instead, where nothing can skip it.

test('"both" still means English and Spanish', () => {
  assert.equal(asDocLanguage('both'), 'en_es', 'every vendor and order already storing it must keep working')
  assert.equal(asDocLanguage('en_es'), 'en_es')
  assert.equal(asDocLanguage('en_it'), 'en_it')
  assert.equal(asDocLanguage('it'), 'it')
  assert.equal(asDocLanguage(null), 'en')
  assert.equal(asDocLanguage('klingon'), 'en', 'anything unrecognised falls back rather than throwing')
})

test('Italian chrome exists for every label, and differs from English', () => {
  const keys = ['purchaseOrder', 'no', 'for', 'date', 'expected', 'terms', 'draft', 'vendor',
    'address', 'billTo', 'item', 'qty', 'unit', 'price', 'amount', 'total', 'knownSubtotal',
    'totalUnits', 'notes', 'style'] as const
  for (const k of keys) {
    const it = label('it', k)
    assert.ok(it && it.trim().length > 0, `no Italian for "${k}"`)
    // "Total" and "Totale" differ; a key that came back identical to English
    // would mean the Italian was never written and the English leaked through.
    if (k !== 'no') {
      assert.notEqual(it, label('en', k), `Italian for "${k}" is just the English word`)
    }
  }
  assert.equal(label('it', 'purchaseOrder'), 'ORDINE DI ACQUISTO')
  assert.equal(label('it', 'vendor'), 'FORNITORE')
  assert.equal(label('it', 'draft'), 'BOZZA — NON INVIATO')
})

test('a bilingual label carries both halves', () => {
  assert.equal(label('en_it', 'item'), 'ITEM / ARTICOLO')
  assert.equal(label('en_es', 'item'), 'ITEM / ARTÍCULO')
  assert.equal(label('en_it', 'total'), 'Total / Totale')
  // Identical words print once rather than "X / X".
  assert.equal(label('en_es', 'total'), 'Total')
  // And the near-identical ones stay single, which is why Attn is special.
  assert.equal(label('en_it', 'attn'), 'Attn:')
})

test('dates take each language its own shape', () => {
  const d = new Date('2026-09-21T19:00:00Z')
  assert.equal(formatDate('en', d), 'September 21, 2026')
  assert.equal(formatDate('it', d), '21 settembre 2026')
  assert.equal(formatDate('en_it', d), 'September 21, 2026 / 21 settembre 2026')
})

test('the confirm sentence is stored, never invented', () => {
  const en = 'Please confirm receipt.'
  const it = 'La preghiamo di confermare la ricezione.'
  assert.equal(confirmSentence('en_it', en, { it }), `${en}\n${it}`)
  assert.equal(confirmSentence('it', en, { it }), it)
  // No Italian written yet: an English sentence a vendor can puzzle out beats
  // a machine translation they act on wrongly.
  assert.equal(confirmSentence('en_it', en, {}), en)
  assert.equal(confirmSentence('it', en, { es: 'spanish one' }), en, 'never reaches for the wrong language')
})
