import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wholesaleOnlyProblem } from '../lib/mouse/tools'

// 12 Oct 2026: Cannellini and Espresso Petite Bean Bags are wholesale only,
// like the Red Petite, but create_product_variants refused because the Bean
// Bag is on Shopify.
const beanBag = { variants: [
  { colorwayId: 'champagne', shopifyVariantId: '47685187633405' },
  { colorwayId: 'black', shopifyVariantId: '47685187698941' },
  { colorwayId: 'red', shopifyVariantId: null },
] }

test('colours that are not on Shopify can be made here as wholesale only', () => {
  assert.equal(wholesaleOnlyProblem(beanBag, ['cannellini', 'espresso']), null)
  assert.equal(wholesaleOnlyProblem(beanBag, ['red']), null, 'the Red Petite is app-only already')
})

test('a colour Shopify sells, or no colour named, is still made in Shopify', () => {
  assert.match(wholesaleOnlyProblem(beanBag, ['cannellini', 'black'])!, /already sold on Shopify/)
  assert.match(wholesaleOnlyProblem(beanBag, [])!, /colourways named/)
  assert.match(wholesaleOnlyProblem(beanBag, undefined)!, /colourways named/)
})
