import assert from 'node:assert/strict'
import test from 'node:test'
import { pickBomLine } from '../lib/bom'

const line = (id: string, qty: number, size: string | null = null, colorway: string | null = null) => ({ id, qtyPerUnit: qty, size, colorway })

test('one component can have a line per size: Petite and Medium Bean Bag leather', () => {
  const petite = line('p', 3.44, 'Petite')
  assert.deepEqual(pickBomLine([petite], true, 'Medium', null), { line: null }) // a new Medium line
  assert.equal((pickBomLine([petite], true, 'Petite', null) as { line: { id: string } }).line.id, 'p') // changes the Petite one
})

test('scope left out means the one line there is, and asks when there are several', () => {
  assert.equal((pickBomLine([line('a', 2)], false, null, null) as { line: { id: string } }).line.id, 'a')
  assert.deepEqual(pickBomLine([], false, null, null), { line: null })
  assert.ok('error' in pickBomLine([line('p', 3.44, 'Petite'), line('m', 4.48, 'Medium')], false, null, null))
})

test('an all-variants line never sits beside a scoped one to count twice', () => {
  // A placeholder with no amount becomes the scoped line.
  assert.equal((pickBomLine([line('a', 0)], true, null, 'Black') as { line: { id: string } }).line.id, 'a')
  // One with an amount is refused, not doubled.
  assert.ok('error' in pickBomLine([line('a', 3.44)], true, 'Medium', null))
  // And a new all-variants line beside scoped ones is refused too.
  assert.ok('error' in pickBomLine([line('p', 3.44, 'Petite')], true, null, null))
})
