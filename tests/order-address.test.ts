import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeShipTo, shipToLine } from '../lib/support/orders'

const ines = { name: 'Ines Frankfurt', address1: '627 Willoughby Ave', address2: 'Ground Floor', city: 'Brooklyn', provinceCode: 'NY', zip: '11206', countryCode: 'US' }

test('only the part a person names changes', () => {
  const next = mergeShipTo(ines, { address1: '629 Willoughby Ave' })
  assert.deepEqual(next, { ...ines, address1: '629 Willoughby Ave' })
})

test('an empty value clears that part, and the line reads like an address', () => {
  const next = mergeShipTo(ines, { address2: '' })
  assert.equal(next.address2, null)
  assert.equal(shipToLine(next), 'Ines Frankfurt, 627 Willoughby Ave, Brooklyn NY 11206, US')
})
