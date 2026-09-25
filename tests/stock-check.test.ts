import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stockChangesThisTurn } from '../lib/mouse/agent'

test('each stock change reads as item, change, before and after', () => {
  const lines = stockChangesThisTurn([
    { name: 'log_inventory_event', status: 'succeeded', input: { type: 'RECEIVED', deltaQty: 8, productVariantId: 'v' }, result: { name: 'Bean Bag / Black / Petite', newQty: 16, shopify: 'pushed +8 to Shopify' } },
    { name: 'log_inventory_event', status: 'succeeded', input: { type: 'COUNTED', countedQty: 3000, componentId: 'c' }, result: { name: 'Glassine bags', newQty: 3000 } },
    { name: 'log_inventory_event', status: 'failed', input: { type: 'RECEIVED', deltaQty: 8 }, result: { error: 'duplicate' } },
    { name: 'add_note', status: 'succeeded', input: {}, result: {} },
  ])
  assert.deepEqual(lines, [
    '- Bean Bag / Black / Petite: RECEIVED +8, was 8, now 16 (pushed +8 to Shopify)',
    '- Glassine bags: counted 3000, now 3000',
  ])
})

test('no stock change, no check', () => {
  assert.deepEqual(stockChangesThisTurn([{ name: 'query_status', status: 'succeeded' }]), [])
})
