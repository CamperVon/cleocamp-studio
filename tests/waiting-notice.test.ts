import { test } from 'node:test'
import assert from 'node:assert/strict'
import { campaignKey, renderNotice, waitingItems } from '../lib/waiting-notice'

const m = { product: 'Cleo Tee', colours: ['Black', 'White'] }

test('only unshipped pieces of the product, in the chosen colours, count', () => {
  const items = waitingItems([
    { title: 'Cleo Tee', variantTitle: 'Black / 1', unfulfilledQuantity: 1 },
    { title: 'Cleo Tee', variantTitle: 'White / 2', unfulfilledQuantity: 0 },   // already shipped
    { title: 'Cleo Tee - Splish', variantTitle: 'Splish / 1', unfulfilledQuantity: 1 }, // another listing
    { title: 'Cleo Tee', variantTitle: 'Shell / 1', unfulfilledQuantity: 1 },  // another colour
    { title: 'Cleo Tee', variantTitle: 'white / 3', unfulfilledQuantity: 2 },
  ], m)
  assert.deepEqual(items, ['Black Cleo Tee, size 1', '2 × white Cleo Tee, size 3'])
})

test('an order whose tee has shipped and something else is waiting is not included', () => {
  assert.deepEqual(waitingItems([
    { title: 'Cleo Tee - Shell', variantTitle: 'Shell / 1', unfulfilledQuantity: 1 },
    { title: 'Cleo Tee', variantTitle: 'Black / 1', unfulfilledQuantity: 0 },
  ], m), [])
})

test("Cleo's words go out as written, with only the placeholders filled in", () => {
  const t = 'Hi {first_name},\n\nYour {items} (order {order}) ships Friday.\n\nCleo'
  assert.equal(
    renderNotice(t, { name: '#2243', firstName: 'Ana', items: ['White Cleo Tee, size 1', 'Black Cleo Tee, size 1'] }),
    'Hi Ana,\n\nYour White Cleo Tee, size 1 and Black Cleo Tee, size 1 (order #2243) ships Friday.\n\nCleo',
  )
  assert.equal(renderNotice('Hi {first_name}, thanks.', { name: '#1', firstName: null, items: [] }), 'Hi there, thanks.')
  assert.equal(renderNotice('No placeholders here.', { name: '#1', firstName: 'Ana', items: ['x'] }), 'No placeholders here.')
})

test('the same notice is the same campaign however the colours are typed', () => {
  assert.equal(campaignKey({ product: 'Cleo Tee', colours: ['White', 'Black'] }, 'Ships Friday'), campaignKey({ product: ' cleo tee', colours: ['black', 'white '] }, 'Ships Friday '))
  assert.notEqual(campaignKey(m, 'Ships Friday'), campaignKey(m, 'Ships Monday'))
})
