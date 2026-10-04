import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forLine } from '../lib/po-pdf'

const bag = { id: 'p_bag', name: 'Cleo Bag — Silver' }

test('an order of one product, or materials for it, prints its name as For', () => {
  assert.equal(forLine({ forProduct: bag, lines: [{ productVariant: { productId: 'p_bag' } }, { productVariant: null }] }), 'Cleo Bag — Silver')
  assert.equal(forLine({ forProduct: bag, lines: [{ productVariant: null }] }), 'Cleo Bag — Silver')
})

test('an order covering several products prints no For line (PO 2389, 4 Oct 2026)', () => {
  assert.equal(forLine({ forProduct: bag, lines: [{ productVariant: { productId: 'p_bag' } }, { productVariant: { productId: 'p_bean' } }] }), null)
  assert.equal(forLine({ forProduct: null, lines: [{ productVariant: { productId: 'p_bag' } }] }), null)
})
