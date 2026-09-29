import { test } from 'node:test'
import assert from 'node:assert/strict'
import { poNumberIn } from '@/lib/po-receipts'

test('poNumberIn finds the PO number Mouse writes in a note', () => {
  assert.equal(poNumberIn('Staples delivery 25 Sept, PO 2362 partial'), '2362')
  assert.equal(poNumberIn('Received on PO #2371 from Lorena'), '2371')
  assert.equal(poNumberIn('arrived from L&L (PO2375)'), '2375')
  assert.equal(poNumberIn('picked up 22 Sept'), null)
})
