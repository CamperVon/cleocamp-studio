import assert from 'node:assert/strict'
import test from 'node:test'
import { onNoProduct } from '../lib/bom'

test('a component on no product is flagged, packaging never is', () => {
  assert.equal(onNoProduct({ category: 'MATERIAL', _count: { usedIn: 0 } }), true)
  assert.equal(onNoProduct({ category: 'HARDWARE', _count: { usedIn: 0 } }), true)
  assert.equal(onNoProduct({ category: 'MATERIAL', _count: { usedIn: 2 } }), false)
  assert.equal(onNoProduct({ category: 'PACKAGING', _count: { usedIn: 0 } }), false)
})
