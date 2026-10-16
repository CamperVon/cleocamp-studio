import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planShopifySkus, type StoreVariant } from '../lib/shopify-sku-rekey'

const v = (sku: string, title = sku): StoreVariant => ({ variantId: `gid://shopify/ProductVariant/${title}`, productId: 'gid://shopify/Product/1', handle: 'h', title, sku })

test('the style prefix is swapped per the table; colour and size stay', () => {
  const p = planShopifySkus([v('TP101-BLK-01'), v('AC102-CHC-OS'), v('PT101-NAT-OS'), v('BG105-CHP-PT')], new Map())
  assert.deepEqual(p.change.map((c) => c.newSku), ['TCO101-BLK-01', 'ABH101-CHC-OS', 'XBT101-NAT-OS', 'HBN101-CHP-PT'])
  assert.deepEqual(p.problems, [])
})

test('the Cleo Bag split follows the app: Denim to HCD101, Olive stays on HCB101; unknown colour is a problem, not a guess', () => {
  const app = new Map([['BG101-DBL-OS', 'HCD101-DBL-OS'], ['BG101-OLV-OS', 'HCB101-OLV-OS']])
  const p = planShopifySkus([v('BG101-DBL-OS'), v('BG101-OLV-OS'), v('BG101-ZZZ-OS')], app)
  assert.deepEqual(p.change.map((c) => c.newSku), ['HCD101-DBL-OS', 'HCB101-OLV-OS'])
  assert.match(p.skip[0].reason, /split into HCB101 and HCD101/)
  assert.match(p.problems.join(), /BG101-ZZZ-OS could be HCB101 or HCD101/)
})

test('skipped with a reason: blank, legacy, already new, Dolce; a disagreement with the app or a duplicate stops it', () => {
  const p = planShopifySkus([v(''), v('CCSS25COT-BLK01-OLD'), v('TCO101-BLK-02'), v('DR106-BLK-01')], new Map())
  assert.deepEqual(p.skip.map((s) => s.reason), ['no SKU', 'not a style-number SKU (legacy or archived listing); left as it is', 'already on the new system', 'DR106 (Dolce) has no new number yet'])
  assert.deepEqual(p.problems, [])
  assert.match(planShopifySkus([v('TP101-BLK-01')], new Map([['TP101-BLK-01', 'TCW101-BLK-01']])).problems.join(), /in the app/)
  assert.match(planShopifySkus([v('TP101-BLK-01', 'a'), v('TCO101-BLK-01', 'b')], new Map()).problems.join(), /Duplicate SKU TCO101-BLK-01/)
  assert.match(planShopifySkus([v('ZZ101-BLK-01')], new Map()).problems.join(), /not in the re-key table/)
})

test('a pattern code never becomes a SKU', () => {
  const p = planShopifySkus([v('TP101-BLK-01')], new Map())
  for (const c of p.change) assert.doesNotMatch(c.newSku, /-P\d+$/)
})
