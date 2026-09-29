import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderName } from '@/lib/order-status'

test('orderName reads the number however it is typed', () => {
  assert.equal(orderName('2237'), '#2237')
  assert.equal(orderName('#2237'), '#2237')
  assert.equal(orderName('order 2237 please'), '#2237')
  assert.equal(orderName('hello'), null)
})
