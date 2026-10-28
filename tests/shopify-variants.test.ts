import assert from 'node:assert/strict'
import test from 'node:test'
import { planNewVariants, variantInput, type ShopifySibling } from '../lib/shopify-variants'

const v = (colour: string, size: string, price = '94.00'): ShopifySibling => ({
  id: `gid://shopify/ProductVariant/${colour}${size}`, price, compareAtPrice: null, inventoryPolicy: 'DENY', taxable: true,
  selectedOptions: [{ name: 'Color', value: colour }, { name: 'Size', value: size }],
  inventoryItem: { tracked: true, requiresShipping: true, countryCodeOfOrigin: 'US', harmonizedSystemCode: '610990', measurement: { weight: { value: 6, unit: 'OUNCES' } } },
})
const cosmo = [v('Red Stripe', '1'), v('Red Stripe', '2'), v('Red Stripe', '3'), v('Red Stripe', '4')]

test('new sizes are planned from the largest existing size of the same colour', () => {
  const p = planNewVariants(['Color', 'Size'], cosmo, ['Red Stripe'], ['4', '5', '6'])
  assert.deepEqual(p.problems, [])
  assert.deepEqual(p.already, ['Red Stripe / 4'])
  assert.deepEqual(p.make.map((m) => m.label), ['Red Stripe / 5', 'Red Stripe / 6'])
  assert.equal(p.make[0].like.id, cosmo[3].id)
  assert.deepEqual(p.make[0].optionValues, [{ optionName: 'Color', name: 'Red Stripe' }, { optionName: 'Size', name: '5' }])
})

test('the Shopify input copies price, stock policy, customs and weight, at 0 in the studio', () => {
  const [m] = planNewVariants(['Color', 'Size'], cosmo, ['Red Stripe'], ['5']).make
  const input = variantInput(m, 'gid://shopify/Location/1')
  assert.equal(input.price, '94.00')
  assert.equal(input.inventoryPolicy, 'DENY')
  assert.deepEqual(input.inventoryQuantities, [{ locationId: 'gid://shopify/Location/1', availableQuantity: 0 }])
  assert.equal(input.inventoryItem.harmonizedSystemCode, '610990')
  assert.equal(input.inventoryItem.countryCodeOfOrigin, 'US')
  assert.deepEqual(input.inventoryItem.measurement, { weight: { value: 6, unit: 'OUNCES' } })
})

test('a product with a third option, or nothing to copy, is refused rather than guessed', () => {
  assert.ok(planNewVariants(['Color', 'Material', 'Size'], cosmo, ['Red Stripe'], ['5']).problems.length)
  assert.ok(planNewVariants(['Color', 'Size'], [], ['Red Stripe'], ['5']).problems.length)
  assert.ok(planNewVariants(['Color'], [v('Red Stripe', '1')], ['Red Stripe'], ['5']).problems.length)
})

test('a new colour copies any variant when none of that colour exists', () => {
  const p = planNewVariants(['Color', 'Size'], cosmo, ['Navy Stripe'], ['1'])
  assert.equal(p.make.length, 1)
  assert.deepEqual(p.make[0].optionValues, [{ optionName: 'Color', name: 'Navy Stripe' }, { optionName: 'Size', name: '1' }])
})
