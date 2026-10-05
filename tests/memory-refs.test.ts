import { test } from 'node:test'
import assert from 'node:assert/strict'
import { madeRefs } from '../lib/mouse/agent'

test('what a tool made is remembered by name and reference', () => {
  assert.equal(madeRefs({ id: 'cmuvwaymo', name: 'Waymo Commercial' }), 'Waymo Commercial [cmuvwaymo]')
  assert.equal(madeRefs({ sent: false, draft: 'D41', draftOrderId: 'gid://shopify/DraftOrder/9' }), 'draft D41; draftOrderId gid://shopify/DraftOrder/9')
  assert.equal(madeRefs({ saved: true, stylist: { id: 's1', name: 'Natasha Colvin' } }), 'Natasha Colvin [s1]')
  assert.equal(madeRefs({ saved: true, pullId: 'p1', stylist: 'Natasha' }), 'pullId p1')
  assert.equal(madeRefs(undefined), '')
})
