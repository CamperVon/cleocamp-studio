import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAddress, addressLines } from '../lib/live-sale'

test("Turn Shop's London address reads, with the UK postcode on its own", () => {
  assert.deepEqual(parseAddress("47 King Henry's Walk, London, N1 4NH, UK"), {
    address1: "47 King Henry's Walk", address2: null, city: 'London', provinceCode: null, zip: 'N1 4NH', countryCode: 'GB',
  })
})

test('a postcode beside the city, either side', () => {
  assert.equal(parseAddress("47 King Henry's Walk, London N1 4NH, United Kingdom")?.zip, 'N1 4NH')
  const paris = parseAddress('12 Rue de Turenne, 75003 Paris, France')
  assert.equal(paris?.zip, '75003'); assert.equal(paris?.city, 'Paris'); assert.equal(paris?.countryCode, 'FR')
})

test('abroad with no postcode or no street is refused, not guessed', () => {
  assert.equal(parseAddress("King Henry's Walk, London, UK")?.zip ?? null, null)
  assert.equal(parseAddress('London, N1 4NH, UK'), null)
})

test('US addresses read exactly as before', () => {
  assert.deepEqual(parseAddress('2030 Hillhurst Ave, Los Angeles, CA 90027'), {
    address1: '2030 Hillhurst Ave', address2: null, city: 'Los Angeles', provinceCode: 'CA', zip: '90027', countryCode: 'US',
  })
  assert.equal(parseAddress('29 Ludlow St, New York, NY'), null)
})

test('the label line says the country abroad', () => {
  const a = parseAddress("47 King Henry's Walk, London, N1 4NH, UK")!
  assert.equal(addressLines({ ...a, company: 'Turn Shop' }), "Turn Shop / 47 King Henry's Walk / London N1 4NH United Kingdom")
})
