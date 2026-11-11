import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nearestId } from '../lib/near-id'

const ids = ['cmwcec0dr000708l08w63atuu', 'cmwcdivf5000c07ldfb8eka4u', 'cmwcftbm1000t08l0fgthfx57']

test('a one-character copy slip finds the item it was meant to be (Cinergy todo, 11 Nov 2026)', () => {
  assert.equal(nearestId('cmwcec0dr000707l08w63atuu', ids), 'cmwcec0dr000708l08w63atuu')
})

test('a dropped or doubled character still matches', () => {
  assert.equal(nearestId('cmwcec0dr00708l08w63atuu', ids), 'cmwcec0dr000708l08w63atuu')
  assert.equal(nearestId('cmwcec0dr0000708l08w63atuu', ids), 'cmwcec0dr000708l08w63atuu')
})

test('an id nothing is close to, or close to two, gives no guess', () => {
  assert.equal(nearestId('cmzzzzzzzzzzzzzzzzzzzzzzz', ids), null)
  assert.equal(nearestId('cmaaaaaaaa000000000000001', ['cmaaaaaaaa000000000000000', 'cmaaaaaaaa000000000000002']), null)
})

test('an exact id, or a short scrap, is not a near miss', () => {
  assert.equal(nearestId('cmwcec0dr000708l08w63atuu', ids), null)
  assert.equal(nearestId('cmw', ids), null)
})

test('the right start with a made-up tail finds the item (Wilde\'s samples todo, 11 Nov 2026)', () => {
  const real = ['cmw9urp7o000k08l3dtixw1bj', 'cmw9urp7o000m08l3qqqqqqqq']
  assert.equal(nearestId('cmw9urp7o000k08l3ln5o0jx4', real), 'cmw9urp7o000k08l3dtixw1bj')
  assert.equal(nearestId('cmw9urp7o000k08l3ln5o0jx4', [...real, 'cmw9urp7o000k08l3zzzzzzzz']), null)
})
