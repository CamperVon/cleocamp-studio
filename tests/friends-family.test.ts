import { test } from 'node:test'
import assert from 'node:assert/strict'
import { friendsFamilyRefund, friendsFamilyText, FRIENDS_AND_FAMILY } from '@/lib/friends-family'

test('Friends and Family is 20%', () => {
  assert.equal(FRIENDS_AND_FAMILY.percent, 20)
})

test('the refund is 20% of the goods and their tax, not shipping', () => {
  assert.equal(friendsFamilyRefund(88, 0), 17.6) // #2642: $88 tee, $7 shipping left out
  assert.equal(friendsFamilyRefund(368, 35.88), 80.78)
})

test('the customer note is fixed text with the amount and order', () => {
  const t = friendsFamilyText('Morgan', '#2642', 17.6)
  assert.match(t, /^Hi Morgan,/)
  assert.match(t, /order #2642 gets our Friends and Family discount of 20%/)
  assert.match(t, /refunded \$17\.60/)
  assert.match(t, /Kindly,\nCleo Studio$/)
  assert.match(friendsFamilyText(null, '#1', 1), /^Hi there,/)
})
