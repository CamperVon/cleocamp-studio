import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftInput, type SaleLine } from '../lib/live-sale'

// Cleo, 3 Nov 2026: a Friends and Family invoice with the tax waived, then
// with $14 off instead. Shopify holds one order discount, so with both the
// 20% goes on each line and the $14 on the order.
const lines: SaleLine[] = [
  { shopifyVariantId: '47536483336445', label: 'Cleo Tee / White / 1', quantity: 1 },
  { shopifyVariantId: '47536483238141', label: 'Cleo Tee / Black / 1', quantity: 1 },
]
const ff = { percent: 20, title: 'Friends and Family' }

test('Friends and Family alone stays one order discount, lines untouched', () => {
  const d = draftInput('a@example.com', lines, 'n', { discount: ff })
  assert.deepEqual(d.appliedDiscount, { value: 20, valueType: 'PERCENTAGE', title: 'Friends and Family' })
  for (const l of d.lineItems) assert.ok(!('appliedDiscount' in l))
})

test('Friends and Family plus an amount off: 20% per line, the amount on the order', () => {
  const d = draftInput('a@example.com', lines, 'n', { discount: ff, fixedDiscount: { amount: 14, title: '$14.00 off' } })
  assert.deepEqual(d.appliedDiscount, { value: 14, valueType: 'FIXED_AMOUNT', title: '$14.00 off' })
  for (const l of d.lineItems) assert.deepEqual((l as { appliedDiscount?: unknown }).appliedDiscount, { value: 20, valueType: 'PERCENTAGE', title: 'Friends and Family' })
})

test('an amount off alone is the order discount', () => {
  const d = draftInput('a@example.com', lines, 'n', { fixedDiscount: { amount: 14, title: '$14.00 off' } })
  assert.deepEqual(d.appliedDiscount, { value: 14, valueType: 'FIXED_AMOUNT', title: '$14.00 off' })
  for (const l of d.lineItems) assert.ok(!('appliedDiscount' in l))
})

test('no sales tax is said on the draft, and said false otherwise', () => {
  assert.equal(draftInput('a@example.com', lines, 'n', { taxExempt: true }).taxExempt, true)
  assert.equal(draftInput('a@example.com', lines, 'n', { discount: ff }).taxExempt, false)
})
