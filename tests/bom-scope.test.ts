import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineFits, lineScopeLabel, matchColorway } from '../lib/bom'

// The Bean Bag's four silk linings, one per colour (6 Oct 2026). Synthetic variants.
const v = (colour: string, size: string) => ({ size, colorway: { customerName: colour } })
const bag = [v('Black', 'Petite'), v('Champagne', 'Petite'), v('Red', 'Petite'), v('Silver', 'Medium')]

test('a line for one colour fits that colour only, in any case', () => {
  assert.deepEqual(bag.filter((x) => lineFits({ colorway: 'black' }, x)).map((x) => x.colorway.customerName), ['Black'])
  assert.equal(bag.filter((x) => lineFits({}, x)).length, 4) // no limit: every variant
  assert.equal(bag.filter((x) => lineFits({ size: 'Petite' }, x)).length, 3)
  assert.equal(bag.filter((x) => lineFits({ colorway: 'Silver', size: 'Petite' }, x)).length, 0) // both must hold
  assert.equal(lineFits({ colorway: 'Black' }, { size: 'Petite', colorway: null }), false)
})

test('the label says what the line is limited to', () => {
  assert.equal(lineScopeLabel({ colorway: 'Black' }), ' (Black only)')
  assert.equal(lineScopeLabel({ size: '2' }), ' (size 2 only)')
  assert.equal(lineScopeLabel({ colorway: 'Black', size: '2' }), ' (Black, size 2 only)')
  assert.equal(lineScopeLabel({}), '')
})

test("a colour is stored in the product's own spelling, and an unknown one is refused", () => {
  const colours = [{ customerName: 'Champagne' }, { customerName: 'Black' }]
  assert.equal(matchColorway('champagne ', colours), 'Champagne')
  assert.equal(matchColorway('Olive', colours), null)
})
