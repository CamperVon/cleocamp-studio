import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleFromUrl, lookalikes, readOptions } from '../lib/shopify-import'

test('colour and size read from Shopify options', () => {
  assert.deepEqual(readOptions([{ name: 'Color', value: 'Red Stripe' }, { name: 'Size', value: '1' }]), { colour: 'Red Stripe', size: '1' })
  assert.deepEqual(readOptions([{ name: 'Style', value: 'Naked' }]), { colour: 'Naked', size: null })
  assert.deepEqual(readOptions([{ name: 'Handle Color', value: 'Gold' }]), { colour: 'Gold', size: null })
  assert.deepEqual(readOptions([{ name: 'Size', value: 'Extra Small' }]), { colour: null, size: 'Extra Small' })
  assert.deepEqual(readOptions([{ name: 'Title', value: 'Default Title' }]), { colour: null, size: null })
})

test('a product link gives its handle', () => {
  assert.equal(handleFromUrl('https://cleocamp.com/products/sardine?variant=71422551130365'), 'sardine')
  assert.equal(handleFromUrl('Sardine'), null)
})

test('a similar name in the app is found before making a second one', () => {
  const app = [{ name: 'Hair Tie' }, { name: 'Cosmo Stripe Tee' }, { name: 'Cleo Tee' }, { name: 'Bateau Body — Muslin Canvas (part)' }]
  assert.deepEqual(lookalikes('Flower Hair Tie', app).map((p) => p.name), ['Hair Tie'])
  assert.deepEqual(lookalikes('Sardine', app), [])
  assert.deepEqual(lookalikes('Cleo Tee', app).map((p) => p.name), ['Cleo Tee'])
})
