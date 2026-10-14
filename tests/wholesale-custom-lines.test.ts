import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wholesaleLineStock } from '../lib/mouse/tools'

// 13 Oct 2026: an app-only colour (a wholesale-only Red Petite Bean Bag) on an
// invoice that takes the tees off Shopify stock refused the whole invoice.
test('an app-only colour always goes on as a custom line, and says why', () => {
  const reducing = wholesaleLineStock(true, null)
  assert.equal(reducing.noStock, true)
  assert.match(reducing.note ?? '', /custom line[\s\S]*no Shopify stock comes off[\s\S]*log that separately/)
  const leaving = wholesaleLineStock(false, null)
  assert.equal(leaving.noStock, true)
  assert.match(leaving.note ?? '', /custom line/)
})

test('a Shopify item follows reduceStock, with nothing to say', () => {
  assert.deepEqual(wholesaleLineStock(true, '47536483238141'), { noStock: false, note: null })
  assert.deepEqual(wholesaleLineStock(false, '47536483238141'), { noStock: true, note: null })
})
