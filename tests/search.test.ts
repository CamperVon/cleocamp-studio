import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distance, norm, poNumberIn, rankHits, scoreText } from '../lib/search'

// Synthetic records; nothing here is real data.
const rec = (kind: string, label: string, also: string[] = [], exact = false) => ({ kind, label, href: `/${kind}#rec-${label}`, also, exact })
const all = [
  rec('vendor', 'Lorena Leather', ['Lorena Santos']),
  rec('vendor', 'Ohio Weaver Supply'),
  rec('product', 'Boy Belt'),
  rec('product', 'Bateau Bag'),
  rec('product', 'Petite Bateau Bag'),
  rec('component', 'Belt buckle, brass'),
  rec('po', 'PO 2391 · United Leather', ['PO 2391']),
  rec('po', 'PO 2390 · Empire', ['PO 2390']),
  rec('stylist', 'Kaley Azambuja', ['azambujakaley@example.com']),
]

test('an exact name beats one that starts with it, which beats a word that does', () => {
  assert.equal(rankHits('bateau bag', all)[0].label, 'Bateau Bag')
  assert.deepEqual(rankHits('bateau', all).map((h) => h.label), ['Bateau Bag', 'Petite Bateau Bag'])
  assert.deepEqual(rankHits('belt', all).map((h) => h.label), ['Belt buckle, brass', 'Boy Belt']) // starts with it, then a word in it
  assert.ok(scoreText('boy belt', 'Boy Belt') > scoreText('boy', 'Boy Belt'))
})

test('a small typo still finds the name', () => {
  assert.equal(rankHits('lorna', all)[0].label, 'Lorena Leather')
  assert.equal(rankHits('weavr', all)[0].label, 'Ohio Weaver Supply')
  assert.equal(distance('kitten', 'sitting'), 3)
  assert.equal(rankHits('zzzz', all).length, 0)
})

test('a PO number goes to that PO, never a neighbouring one', () => {
  assert.equal(poNumberIn('2391'), '2391')
  assert.equal(poNumberIn('PO #2391'), '2391')
  assert.equal(poNumberIn('boy belt'), null)
  const withExact = all.map((r) => r.kind === 'po' ? { ...r, exact: r.label.includes('2391') } : r)
  const hits = rankHits('2391', withExact)
  assert.equal(hits[0].label, 'PO 2391 · United Leather')
  assert.ok(!hits.some((h) => h.label.includes('2390')))
})

test('other names and emails find the record, a little behind its own name', () => {
  assert.equal(rankHits('santos', all)[0].label, 'Lorena Leather')
  assert.equal(rankHits('azambujakaley', all)[0].label, 'Kaley Azambuja')
  assert.equal(norm('  Café—Forgot! '), 'cafe forgot')
})
