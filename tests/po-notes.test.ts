import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vendorNoteProblem } from '../lib/po-notes'

test('the PO 2362 note is refused', () => {
  const why = vendorNoteProblem("Staples confirmed a partial delivery of 18 pieces arriving 25 Sept, ahead of Cleo's 27 Sept sale.", 'Staples LA USA')
  assert.ok(why)
  assert.match(why!, /Staples confirmed/)
  assert.match(why!, /Cleo's/)
})

test('the PO 2360 kind of note is refused', () => {
  assert.ok(vendorNoteProblem('Repriced to $3.75/pc (was $4.25). Brandon disputed the old rate.', 'Antonio'))
})

test('what we would say to a vendor is allowed', () => {
  for (const n of [
    'Please rush: we need these by 10 Oct.',
    'Deposit of $1,200 paid by Zelle on 3 Sept.',
    'Cleo Tee labels go on the left side seam, 2cm from the hem.',
    'Please confirm receipt of this order.',
    'Ship to Antonio, not the studio.',
  ]) assert.equal(vendorNoteProblem(n, 'Staples LA USA'), null, n)
  assert.equal(vendorNoteProblem('', 'x'), null)
  assert.equal(vendorNoteProblem(null), null)
})
