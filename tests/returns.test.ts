import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderNameFrom, refundLessFee, returnReceivedText, returnRefundedText } from '../lib/returns'

test('the restocking fee is 10% of the items, and the tax comes back in full (#2237 Black / 2)', () => {
  // Shopify suggests $96.58: the $88 tee plus $8.58 tax.
  assert.deepEqual(refundLessFee(96.58, 88), { fee: 8.8, refund: 87.78 })
  assert.deepEqual(refundLessFee(0, 0), { fee: 0, refund: 0 })
})

test('an order number is read however it is typed', () => {
  assert.equal(orderNameFrom('2237'), '#2237')
  assert.equal(orderNameFrom('#2237'), '#2237')
  assert.equal(orderNameFrom('order 2237 '), '#2237')
  assert.equal(orderNameFrom('the belt'), null)
})

test('the customer emails are fixed text that says what happens next', () => {
  const lines = [{ lineItemId: 'x', quantity: 1, label: 'Cleo Tee — Black / 2' }]
  const refund = returnReceivedText('Elisabeth', { orderName: '#2237', kind: 'REFUND', lines })
  assert.match(refund, /^Hi Elisabeth,/)
  assert.match(refund, /#2237 \(Cleo Tee — Black \/ 2\) has arrived/)
  assert.match(refund, /less the 10% restocking fee/)
  assert.match(refund, /Kindly,\nCleo Studio$/)
  assert.doesNotMatch(returnReceivedText(null, { orderName: '#2237', kind: 'EXCHANGE', lines }), /fee/)
  assert.match(returnRefundedText('Elisabeth', '#2237', { refund: 87.78, fee: 8.8 }), /refunded \$87\.78 .* \(\$8\.80\)/)
})
