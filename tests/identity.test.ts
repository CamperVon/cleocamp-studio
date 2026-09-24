import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchInboundAddress, type IdentityCandidate } from '../lib/mouse/identity'

const cleo: IdentityCandidate = {
  id: 'per_cleo', name: 'Cleo', email: 'studio@cleocamp.com',
  aliasEmails: 'cleo@cleocamp.com', phone: '3106223898',
}
const brandon: IdentityCandidate = {
  id: 'per_brandon', name: 'Brandon', email: 'brandon@cleocamp.com',
  aliasEmails: 'bc@thecampbrand.com', phone: null,
}

test('a text that arrives by email is recognised by the number in the address', () => {
  assert.deepEqual(
    matchInboundAddress('3106223898@tmomail.net', [cleo, brandon]),
    { id: 'per_cleo', name: 'Cleo' },
  )
  assert.deepEqual(
    matchInboundAddress('13106223898@vtext.com', [cleo, brandon]),
    { id: 'per_cleo', name: 'Cleo' },
    'a leading country code around the number still contains it',
  )
})

test('an exact address wins over a phone match', () => {
  // Nothing here needs the phone at all — real addresses match first, same
  // as before this existed.
  assert.deepEqual(
    matchInboundAddress('bc@thecampbrand.com', [cleo, brandon]),
    { id: 'per_brandon', name: 'Brandon' },
  )
})

test('nobody with no phone on file is never matched by digits', () => {
  assert.equal(matchInboundAddress('3106223898@tmomail.net', [brandon]), null)
})

test('an unrelated address matches nobody', () => {
  assert.equal(matchInboundAddress('someone@vendor.com', [cleo, brandon]), null)
})

test('a short or missing phone is never used to match', () => {
  const shortPhone: IdentityCandidate = { ...cleo, phone: '898' }
  // Otherwise a badly-cleaned "phone" of a few digits would hit almost any
  // address that happens to contain that run of numbers.
  assert.equal(matchInboundAddress('someone-898@vendor.com', [shortPhone]), null)
})
