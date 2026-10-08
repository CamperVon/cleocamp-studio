import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asSkuDisplayMode, lineLabel, lineView, skuText } from '../lib/po-snapshot'

test('SKU text: new with old in brackets while switching over, new only after', () => {
  assert.equal(skuText({ sku: 'CCSS25COT-WHT01', newSku: 'TP101-WHT-01' }, 'transition'), 'TP101-WHT-01 (was CCSS25COT-WHT01)')
  assert.equal(skuText({ sku: 'CCSS25COT-WHT01', newSku: 'TP101-WHT-01' }, 'new'), 'TP101-WHT-01')
  assert.equal(skuText({ sku: null, newSku: 'TP101-HPK-01' }, 'transition'), 'TP101-HPK-01')
  assert.equal(skuText({ sku: 'CCSS25COT-WHT01', newSku: null }, 'new'), 'CCSS25COT-WHT01')
  assert.equal(skuText({ sku: null, newSku: null }, 'transition'), null)
  assert.equal(asSkuDisplayMode('anything'), 'transition')
})

const live = { sku: 'CCSS25COT-BLK02', newSku: 'TP101-BLK-02', size: '2', imageUrl: 'https://img/new.jpg', product: { name: 'Cleo Tee' }, colorway: { customerName: 'Black' } }

test('a sent line reads what it was sent with, whatever the variant says now', () => {
  const frozen = { snapshotAt: new Date(), snapSku: 'CCSS25COT-BLK02', snapProductName: 'Cleo Tee', snapColorway: 'Black', snapSize: '2', snapImageUrl: 'https://img/old.jpg', productVariant: live }
  const v = lineView(frozen, 'new')!
  assert.equal(lineLabel(v, 'Style'), 'Style CCSS25COT-BLK02 — Cleo Tee — Black / 2')
  assert.equal(v.imageUrl, 'https://img/old.jpg')
})

test('a draft line reads the variant live, in the display mode', () => {
  assert.equal(lineLabel(lineView({ productVariant: live }, 'transition')!, 'Style'), 'Style TP101-BLK-02 (was CCSS25COT-BLK02) — Cleo Tee — Black / 2')
  assert.equal(lineView({ productVariant: null }, 'new'), null)
})

test('the label keeps the format both documents printed before', () => {
  assert.equal(lineLabel({ sku: null, product: 'Bean Bag', colorway: 'Red', size: 'Petite', imageUrl: null }, 'Estilo'), 'Bean Bag — Red / Petite')
})
