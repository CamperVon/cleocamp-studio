import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRepeatOf, looksLikeSameDelivery } from '../lib/inventory-duplicate'

const now = new Date('2026-09-25T18:40:01Z')
const first = { productVariantId: 'var_black_petite', type: 'RECEIVED', deltaQty: 8, createdAt: new Date('2026-09-25T18:39:06Z') }

test('the bean bag case: the same +8 a minute later is a repeat', () => {
  assert.equal(isRepeatOf({ productVariantId: 'var_black_petite', type: 'RECEIVED', deltaQty: 8 }, first, now), true)
})

test('what is not a repeat', () => {
  assert.equal(isRepeatOf({ productVariantId: 'var_black_petite', type: 'RECEIVED', deltaQty: 7 }, first, now), false, 'different amount')
  assert.equal(isRepeatOf({ productVariantId: 'var_red_petite', type: 'RECEIVED', deltaQty: 8 }, first, now), false, 'different item')
  assert.equal(isRepeatOf({ productVariantId: 'var_black_petite', type: 'USED', deltaQty: 8 }, first, now), false, 'different kind of change')
  assert.equal(isRepeatOf({ productVariantId: 'var_black_petite', type: 'RECEIVED', deltaQty: 8 }, first, new Date('2026-09-27T12:00:00Z')), false, 'days later')
  assert.equal(isRepeatOf({ productVariantId: 'var_black_petite', type: 'COUNTED', deltaQty: 8 }, { ...first, type: 'COUNTED' }, now), false, 'a count can always be restated')
})

test('a component event with no place named matches wherever the first one landed', () => {
  const atStudio = { componentId: 'cmp_glassine', locationId: 'loc_studio', type: 'RECEIVED', deltaQty: 500, createdAt: first.createdAt }
  assert.equal(isRepeatOf({ componentId: 'cmp_glassine', type: 'RECEIVED', deltaQty: 500 }, atStudio, now), true)
  assert.equal(isRepeatOf({ componentId: 'cmp_glassine', atVendorId: 'vnd_empire', type: 'RECEIVED', deltaQty: 500 }, atStudio, now), false)
})

test('the Cleo Bag case: a second receipt of the item within a week, any amount, gets a question', () => {
  const phantom = { productVariantId: 'var_black_cleo', type: 'RECEIVED', deltaQty: 3, createdAt: new Date('2026-09-18T18:49:19Z') }
  const on22 = new Date('2026-09-23T00:58:21Z')
  assert.equal(looksLikeSameDelivery({ productVariantId: 'var_black_cleo', type: 'RECEIVED', deltaQty: 3 }, phantom, on22), true)
  assert.equal(looksLikeSameDelivery({ productVariantId: 'var_black_cleo', type: 'RECEIVED', deltaQty: 2 }, phantom, on22), true, 'different amount still asks')
  assert.equal(looksLikeSameDelivery({ productVariantId: 'var_choc_cleo', type: 'RECEIVED', deltaQty: 3 }, phantom, on22), false, 'different item')
  assert.equal(looksLikeSameDelivery({ productVariantId: 'var_black_cleo', type: 'RECEIVED', deltaQty: 3 }, phantom, new Date('2026-09-26T00:00:00Z')), false, 'over a week later')
  assert.equal(looksLikeSameDelivery({ productVariantId: 'var_black_cleo', type: 'USED', deltaQty: -3 }, phantom, on22), false, 'only receipts')
})
