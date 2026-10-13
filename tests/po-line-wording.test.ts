import { test } from 'node:test'
import assert from 'node:assert/strict'
import { poLineLabel } from '../lib/po'

// 13 Oct 2026: "Boy Belt / Small (90)" set on a catalogue line of PO 2403 was
// saved and reported as updated, but the line still read "Boy Belt / Small".
const variant = { product: { name: 'Boy Belt' }, colorway: { customerName: 'Black' }, size: 'Small' }
const line = (description: string | null) => ({ component: null, productVariant: variant as never, description })

test('a catalogue line prints its own wording when one is set', () => {
  assert.equal(poLineLabel(line('Boy Belt / Small (90)')), 'Boy Belt / Small (90)')
})

test('without its own wording it prints the built name, and blank wording does not count', () => {
  assert.equal(poLineLabel(line(null)), 'Boy Belt / Black / Small')
  assert.equal(poLineLabel(line('   ')), 'Boy Belt / Black / Small')
})

test('a described line and a component line are as before', () => {
  assert.equal(poLineLabel({ component: null, productVariant: null, description: 'Bean Bag — Espresso / Petite' }), 'Bean Bag — Espresso / Petite')
  assert.equal(poLineLabel({ component: { name: 'Magnets' } as never, productVariant: null, description: 'ignored' }), 'Magnets')
})
