import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keptOutOfApp, KEPT_OUT_TAG } from '../lib/integrations/shopify'

// 18 Nov 2026: one-off sample-sale pieces must never come into the app as
// stock against the real product.

test('a listing tagged sample-sale is kept out, whatever the case or spacing', () => {
  assert.equal(KEPT_OUT_TAG, 'sample-sale')
  assert.equal(keptOutOfApp(['wholesale', ' Sample-Sale ']), true)
  assert.equal(keptOutOfApp(['sample sale']), false)
  assert.equal(keptOutOfApp([]), false)
  assert.equal(keptOutOfApp(undefined), false)
})
