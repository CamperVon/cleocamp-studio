import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUsAddress, addressLines } from '@/lib/live-sale'

test('parseUsAddress reads a one-line address with a full state name', () => {
  assert.deepEqual(parseUsAddress('2030 Hillhurst Ave, Los Angeles, California 90027'), {
    address1: '2030 Hillhurst Ave', address2: null, city: 'Los Angeles', provinceCode: 'CA', zip: '90027', countryCode: 'US',
  })
})

test('parseUsAddress keeps a suite and drops a trailing country', () => {
  const a = parseUsAddress('100 Orchard St, Suite 4, New York, NY 10002-1234, USA')
  assert.equal(a?.address1, '100 Orchard St')
  assert.equal(a?.address2, 'Suite 4')
  assert.equal(a?.provinceCode, 'NY')
  assert.equal(a?.zip, '10002')
})

test('parseUsAddress refuses anything it would have to guess', () => {
  assert.equal(parseUsAddress('29 Ludlow St, New York, NY'), null) // no ZIP
  assert.equal(parseUsAddress('Hillhurst Ave, Los Angeles, CA 90027'), null) // no street number
  assert.equal(parseUsAddress('2030 Hillhurst Ave, Los Angeles, ZZ 90027'), null) // no such state
  assert.equal(parseUsAddress('Los Angeles, CA 90027'), null)
  assert.equal(parseUsAddress(null), null)
})

test('addressLines prints what the label will say', () => {
  const a = parseUsAddress('2030 Hillhurst Ave, Los Angeles, CA 90027')!
  assert.equal(addressLines({ ...a, company: 'Grandpa LA', firstName: 'Ana', lastName: null }), 'Grandpa LA, Ana / 2030 Hillhurst Ave / Los Angeles, CA 90027')
})
