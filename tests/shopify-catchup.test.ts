import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrivalLines, listingMarker, listingsToCatchUp, lookalikeQuestion } from '../lib/shopify-catchup'

// 8 Oct 2026: the Black and White Boy Belts went on sale on Shopify and the
// app never heard of them, so Mouse could not move one to the stylist
// inventory. Brandon: "mouse should always know when new products /
// variants are added or in shopify".

test('only listings for sale are brought in, once each; drafts wait, archived ones are retired', () => {
  const got = listingsToCatchUp([
    { shopifyProductId: '1', title: 'Boy Belt - Black', status: 'ACTIVE' },
    { shopifyProductId: '1', title: 'Boy Belt - Black', status: 'ACTIVE' },
    { shopifyProductId: '2', title: 'Cosmo Stripe Tee', status: 'DRAFT' },
    { shopifyProductId: '3', title: 'Cleo Tee (old)', status: 'ARCHIVED' },
    { shopifyProductId: '4', title: 'Boy Belt - White', status: 'ACTIVE' },
  ])
  assert.deepEqual(got.map((l) => l.shopifyProductId), ['1', '4'])
})

test('a lookalike is asked about by name, never guessed, and the question carries its listing', () => {
  const q = lookalikeQuestion({ shopifyProductId: '15388353888509', title: 'Flower Hair Tie', status: 'ACTIVE' }, ['Hair Tie'])
  assert.match(q.title, /On Shopify, not in the app: "Flower Hair Tie". Is it "Hair Tie", or a new product\?/)
  assert.ok(q.detail.includes(listingMarker('15388353888509')), 'so the same listing is asked about once')
  assert.match(q.detail, /cannot be counted, invoiced or pulled/)
})

test('what arrived reads as a sentence per product: new, or new sizes and colours', () => {
  assert.deepEqual(arrivalLines([
    { name: 'Boy Belt - Black', isNew: true, parts: ['Extra Small', 'Small', 'Medium', 'Large'] },
    { name: 'Cleo Tee', isNew: false, parts: ['Splash 2'] },
    { name: 'Cachet', isNew: true, parts: [] },
  ]), [
    'Boy Belt - Black is new in the app (Extra Small, Small, Medium, Large).',
    'Cleo Tee has new sizes or colours in the app (Splash 2).',
    'Cachet is new in the app.',
  ])
})
