import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftInput, lineNoteAttributes } from '../lib/live-sale'

// 20 Nov 2026: Cleo asked for a shipped invoice with no shipping charge and
// "* extra holes punched in" on it; Mouse could do neither.

test('free shipping puts a $0 shipping line on the draft', () => {
  const d = draftInput('a@b.com', [{ shopifyVariantId: '1', label: 'Boy Belt', quantity: 1 }], '', { shippingCharge: 0, shippingTitle: 'Free shipping' })
  assert.deepEqual(d.shippingLine, { title: 'Free shipping', priceWithCurrency: { amount: '0.00', currencyCode: 'USD' } })
})

test('no shipping line unless one is asked for', () => {
  const d = draftInput('a@b.com', [{ shopifyVariantId: '1', label: 'Boy Belt', quantity: 1 }], '')
  assert.equal('shippingLine' in d, false)
})

test('a line note goes on that line as a property, and only there', () => {
  const d = draftInput('a@b.com', [
    { shopifyVariantId: '1', label: 'Boy Belt', quantity: 1, note: '  * extra holes   punched in ' },
    { shopifyVariantId: '2', label: 'Tee', quantity: 1 },
  ], '')
  const [belt, tee] = d.lineItems as Array<Record<string, unknown>>
  assert.deepEqual(belt.customAttributes, [{ key: 'Note', value: '* extra holes punched in' }])
  assert.equal('customAttributes' in tee, false)
  assert.deepEqual(lineNoteAttributes(''), [])
})
