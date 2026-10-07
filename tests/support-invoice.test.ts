import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimsInvoice, parseDraft, pickInvoiceProduct, pickTargetVariant } from '../lib/support/reply'

test('the drafter can propose an invoice the team asked for', () => {
  const d = parseDraft(JSON.stringify({ reply: 'Hi', needs: null, newAddress: null, newVariant: null, newInvoice: { item: 'Boy Belt', variant: 'Medium', quantity: 1 } }))!
  assert.deepEqual(d.newInvoice, { item: 'Boy Belt', variant: 'Medium', quantity: 1 })
  assert.equal(parseDraft(JSON.stringify({ reply: 'Hi', needs: null })!)!.newInvoice, null)
  assert.equal(parseDraft(JSON.stringify({ reply: 'Hi', newInvoice: { item: 'Boy Belt', variant: 'Medium', quantity: 500 } }))!.newInvoice!.quantity, 1) // nonsense falls back to 1
})

test('a reply that says an invoice is sent or coming is caught (the #2614 draft, 7 Oct 2026)', () => {
  for (const r of [
    "We're sending you an invoice for a Medium Boy Belt now, so we can ship it right away.",
    "We've sent you an invoice from Shopify.",
    'The invoice is on its way to your inbox.',
    "You'll get an invoice shortly.",
    "We'll email you an invoice for the Medium.",
    'We have invoiced you for the Medium.',
  ]) assert.ok(claimsInvoice(r), r)
  for (const r of [
    'Your order invoice is attached to your Shopify receipt.',
    'If you need a copy of your receipt, let us know.',
    'We can invoice you if you like: just say.',
    'Thanks for the tracking number.',
  ]) assert.ok(!claimsInvoice(r), r)
})

test('the product is found by its shop name, preferring one on her order, and never guessed between two', () => {
  const shop = [{ title: 'Boy Belt', status: 'ACTIVE' }, { title: 'Cleo Tee - Black', status: 'ACTIVE' }, { title: 'Cleo Tee - White', status: 'ACTIVE' }]
  assert.equal((pickInvoiceProduct(shop, 'boy belt') as { product: { title: string } }).product.title, 'Boy Belt')
  assert.match((pickInvoiceProduct(shop, 'Cleo Tee') as { problem: string }).problem, /could be Cleo Tee - Black or Cleo Tee - White/)
  assert.equal((pickInvoiceProduct(shop, 'Cleo Tee', ['Cleo Tee - White']) as { product: { title: string } }).product.title, 'Cleo Tee - White')
  assert.match((pickInvoiceProduct(shop, 'Story Dress') as { problem: string }).problem, /no product called/)
  // And the size, the same way a swap finds it.
  const sizes = [{ id: 'v1', title: 'Small' }, { id: 'v2', title: 'Medium' }]
  assert.deepEqual(pickTargetVariant(sizes, 'medium', null), { ok: true, id: 'v2', title: 'Medium' })
  assert.equal(pickTargetVariant(sizes, 'XL', null).ok, false)
})
