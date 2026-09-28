import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addressBlock } from '@/lib/draft-pdf'

test('addressBlock prints the store, not the store twice', () => {
  const a = { company: 'Grandpa LA', name: 'Grandpa LA', address1: '2030 Hillhurst Ave', address2: null, city: 'Los Angeles', provinceCode: 'CA', zip: '90027' }
  assert.deepEqual(addressBlock(a, 'Grandpa LA'), ['Grandpa LA', '2030 Hillhurst Ave', 'Los Angeles, CA 90027'])
})

test('addressBlock falls back to the customer name with no address', () => {
  assert.deepEqual(addressBlock(null, 'Cosimo'), ['Cosimo'])
})

test('jpegThumb asks Shopify for a small JPEG, and leaves other hosts alone', async () => {
  const { jpegThumb } = await import('@/lib/draft-pdf')
  assert.equal(jpegThumb('https://cdn.shopify.com/s/files/1/x.webp?v=1'), 'https://cdn.shopify.com/s/files/1/x.webp?v=1&width=160&format=jpg')
  assert.equal(jpegThumb('https://example.com/a.jpg'), 'https://example.com/a.jpg')
  assert.equal(jpegThumb(null), null)
})
