import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kitAvailability } from '../lib/kits'

const body = (n: number | null) => ({ name: 'Bateau Body', qty: 1, matchColour: false, variants: [{ colour: null, colourCode: 'NAT', onHand: n }] })
const handles = { name: 'Bateau Handle', qty: 1, matchColour: true, variants: [
  { colour: 'Silver', colourCode: 'SLV', onHand: 6 }, { colour: 'Caspian', colourCode: 'CSP', onHand: 2 }, { colour: 'Gold', colourCode: 'GLD', onHand: null },
] }

test('a bag is available up to the lower of its body and its same-colour handle', () => {
  const [silver, caspian] = kitAvailability([{ colour: 'Silver', colourCode: 'SLV' }, { colour: 'Caspian', colourCode: 'CSP' }], [body(3), handles])
  assert.equal(silver.available, 3) // body 3, handle 6
  assert.equal(caspian.available, 2) // body 3, handle 2
  assert.deepEqual(silver.parts.map((p) => p.onHand), [3, 6])
})

test('an unknown count, or no handle in that colour, is unknown, never zero or a guess', () => {
  const [gold, verdant] = kitAvailability([{ colour: 'Gold', colourCode: 'GLD' }, { colour: 'Verdant', colourCode: 'VRD' }], [body(3), handles])
  assert.equal(gold.available, null)
  assert.equal(verdant.available, null)
  assert.match(verdant.parts[1].problem!, /no Verdant/)
  assert.equal(kitAvailability([{ colour: 'Silver', colourCode: 'SLV' }], [body(null), handles])[0].available, null)
})

test('a part needed twice counts double, and a negative count reads as none', () => {
  const two = { ...handles, qty: 2 }
  assert.equal(kitAvailability([{ colour: 'Silver', colourCode: 'SLV' }], [body(10), two])[0].available, 3)
  assert.equal(kitAvailability([{ colour: 'Silver', colourCode: 'SLV' }], [body(-1), handles])[0].available, 0)
})

test('colours match by code when both have one, else by name', () => {
  const h = { ...handles, variants: [{ colour: 'Silver', colourCode: null, onHand: 4 }] }
  assert.equal(kitAvailability([{ colour: 'silver', colourCode: 'SLV' }], [body(9), h])[0].available, 4)
})
