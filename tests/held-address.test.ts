import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isHeldAddress } from '../lib/held-address'

// 16 Nov 2026: an address saved on a Cleo Crew contact was refused by send_email.

const none = { freeText: [], single: [] }

test('an address on a contact, person, stylist, customer or store is held', () => {
  assert.equal(isHeldAddress('Mia@Example.com', { freeText: [], single: [null, 'mia@example.com'] }), true)
  assert.equal(isHeldAddress('mia@example.com', none), false)
})

test('a vendor field holding several addresses matches whole addresses only', () => {
  const r = { freeText: ['Lorena <lorena@leather.com>, max@gmail.com'], single: [] }
  assert.equal(isHeldAddress('lorena@leather.com', r), true)
  assert.equal(isHeldAddress('x@gmail.com', r), false)
})

test('our own domains are always held', () => {
  assert.equal(isHeldAddress('Studio@Cleocamp.com', none), true)
  assert.equal(isHeldAddress('mouse@send.cleocamp.com', none), true)
  assert.equal(isHeldAddress('a@notcleocamp.com', none), false)
})
