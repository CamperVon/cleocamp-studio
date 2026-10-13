import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carriedOver, nothingCarriedOver } from '../lib/mouse/tools'

// 13 Oct 2026: PO 2409 to Calamo was called a "first order" because nothing
// was carried over, though PO 2398 to Calamo already existed.
test('"first order" only when there is no earlier order to the vendor', () => {
  assert.equal(carriedOver([], true), 'nothing needed carrying over from the last order')
  assert.equal(carriedOver([], false), 'nothing — this is a first order for this vendor')
  assert.deepEqual(carriedOver(['payment terms'], true), ['payment terms'])
})

test('the line for the person never calls a repeat vendor new, and names what is still blank', () => {
  assert.equal(nothingCarriedOver('Calamo Silk', true, ['payment terms']), 'Payment terms not on file for Calamo Silk, here or on earlier orders. Tell me and I will remember them for next time.')
  assert.equal(nothingCarriedOver('Calamo Silk', true, []), '')
  assert.doesNotMatch(nothingCarriedOver('Calamo Silk', true, ['delivery address', 'payment terms']), /first order/i)
  assert.equal(nothingCarriedOver('New Mill', false, ['payment terms']), 'First order for New Mill — payment terms not on file yet. Tell me and I will remember them for next time.')
  assert.equal(nothingCarriedOver('New Mill', false, []), 'First order for New Mill.')
})
