import { test } from 'node:test'
import assert from 'node:assert/strict'
import { depositDiscountPercent, depositProblem, depositTitle, parseDepositTitle } from '../lib/deposit'
import { draftInput } from '../lib/live-sale'

test('D62: half now, the full order kept, the balance written from Shopify\'s own figure', () => {
  assert.equal(depositDiscountPercent(50), 50)
  assert.equal(depositDiscountPercent(30), 70, '30% now leaves 70% off this invoice')
  assert.equal(depositTitle(50, 3530, 'on delivery'), '50% deposit. Balance of $3,530 due on delivery.')
  assert.equal(depositTitle(50, 3530.5, 'by 1 Nov.'), '50% deposit. Balance of $3,530.50 due by 1 Nov.')
  assert.equal(depositTitle(50, null, 'on delivery'), '50% deposit. Balance due on delivery.', 'before Shopify has said, no figure at all')
})

test('a deposit on the draft is read back, so a revision keeps it; anything else is not taken for one', () => {
  assert.deepEqual(parseDepositTitle('50% deposit. Balance of $3,530 due on delivery.'), { percent: 50, balanceDue: 'on delivery' })
  assert.deepEqual(parseDepositTitle('50% deposit. Balance due by 1 Nov.'), { percent: 50, balanceDue: 'by 1 Nov' })
  assert.equal(parseDepositTitle('Friends and Family'), null)
  assert.equal(parseDepositTitle(null), null)
})

test('a deposit needs a whole percent and a when, never an amount', () => {
  assert.equal(depositProblem(50, 'on delivery'), null)
  assert.match(depositProblem(50, '')!, /balanceDue/)
  assert.match(depositProblem(50, '$3,530 on delivery')!, /Shopify works out the amount/)
  assert.match(depositProblem(0, 'on delivery')!, /1 to 99/)
  assert.match(depositProblem(100, 'on delivery')!, /1 to 99/)
  assert.match(depositProblem(33.3, 'on delivery')!, /whole number/)
})

test('the draft sent to Shopify: a deposit discount, a kept fixed discount, or the discount taken off', () => {
  const lines = [{ label: 'Bean Bag', quantity: 2, shopifyVariantId: '47685187698941', priceOverride: 184 }] as never
  const dep = draftInput('store@example.com', lines, 'n', { discount: { percent: 50, title: '50% deposit. Balance due on delivery.' } })
  assert.deepEqual(dep.appliedDiscount, { value: 50, valueType: 'PERCENTAGE', title: '50% deposit. Balance due on delivery.' })
  assert.deepEqual(draftInput('s@e.com', lines, 'n', { fixedDiscount: { amount: 20, title: 'Courtesy' } }).appliedDiscount, { value: 20, valueType: 'FIXED_AMOUNT', title: 'Courtesy' })
  assert.equal(draftInput('s@e.com', lines, 'n', { clearDiscount: true }).appliedDiscount, null)
  assert.ok(!('appliedDiscount' in draftInput('s@e.com', lines, 'n', {})), 'nothing said, nothing sent')
  assert.equal(dep.lineItems[0].priceOverride?.amount, '184.00', 'line prices are left as they are, never halved')
})
