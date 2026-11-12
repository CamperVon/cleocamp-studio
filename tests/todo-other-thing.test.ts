import { test } from 'node:test'
import assert from 'node:assert/strict'
import { otherThing } from '../lib/mouse/tools'

test('the same words about a different product are a different task (size charts, 12 Nov 2026)', () => {
  assert.equal(otherThing({ entityType: 'PRODUCT', entityId: 'prd_cleo_tee' }, { entityType: 'PRODUCT', entityId: 'prd_cosmo_tee' }), true)
})

test('the same product, or either one untagged, can still be a copy', () => {
  assert.equal(otherThing({ entityType: 'PRODUCT', entityId: 'prd_cleo_tee' }, { entityType: 'PRODUCT', entityId: 'prd_cleo_tee' }), false)
  assert.equal(otherThing({ entityType: null, entityId: null }, { entityType: 'PRODUCT', entityId: 'prd_cosmo_tee' }), false)
  assert.equal(otherThing({ entityType: 'PRODUCT', entityId: 'prd_cleo_tee' }, {}), false)
  assert.equal(otherThing({ entityType: 'GENERAL', entityId: 'x' }, { entityType: 'PRODUCT', entityId: 'prd_cosmo_tee' }), false)
})
