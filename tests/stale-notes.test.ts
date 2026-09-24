import { test } from 'node:test'
import assert from 'node:assert/strict'
import { subjectIds } from '../lib/mouse/stale-notes'

test('the ids a change was about come from its input', () => {
  assert.deepEqual(
    subjectIds({ productVariantId: 'var_1', type: 'COUNTED', countedQty: 10, note: 'Jane' }),
    ['var_1'],
  )
  assert.deepEqual(subjectIds({ productId: 'prd_cosmo_tee', set: [{ componentId: 'cmp_x' }] }), ['prd_cosmo_tee'])
  assert.deepEqual(subjectIds({ poNumber: 2375, vendorId: 'vnd_ll' }), ['vnd_ll', '2375'])
  assert.deepEqual(subjectIds({ componentId: 'cmp_buttons', atVendorId: 'vnd_empire' }), ['cmp_buttons', 'vnd_empire'])
})

test('nothing to name means nothing to look up', () => {
  assert.deepEqual(subjectIds(null), [])
  assert.deepEqual(subjectIds('text'), [])
  assert.deepEqual(subjectIds({ to: 'jane@cleocamp.com', body: 'hi', id: '  ' }), [])
})
