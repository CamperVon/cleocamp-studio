import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fallbackPhotos } from '../lib/variant-photos'

// Brandon, 12 Oct 2026: "just because a product is not in shopify should be no
// reason POs don't have pictures". PO 2405 printed Cannellini and Espresso as text.

const v = (id: string, colorwayId: string, name: string, imageUrl: string | null = null) =>
  ({ id, productId: 'bean', colorwayId, imageUrl, colorway: { customerName: name } })

test('a colour without a photo takes another size of the same colour, then the line sheet photo', () => {
  const found = fallbackPhotos(
    [v('cnl-pt', 'cnl', 'Cannellini'), v('red-pt', 'red', 'Red'), v('esp-pt', 'esp', 'Espresso'), v('blk-pt', 'blk', 'Black', 'https://cdn/blk.jpg')],
    [{ productId: 'bean', colorwayId: 'cnl', imageUrl: '/api/photo/f1' }, { productId: 'bean', colorwayId: 'blk', imageUrl: 'https://cdn/blk.jpg' }],
    [{ id: 'row9', productId: 'bean', colorway: 'red' }, { id: 'row1', productId: 'other', colorway: 'Espresso' }],
  )
  assert.equal(found.get('cnl-pt'), '/api/photo/f1')
  assert.equal(found.get('red-pt'), '/api/photo/ls_row9', 'line sheet colour matched without regard to case')
  assert.equal(found.has('esp-pt'), false, 'never another product\'s photo')
  assert.equal(found.has('blk-pt'), false, 'a variant with its own photo keeps it')
})

test('another colour\'s photo is never borrowed', () => {
  const found = fallbackPhotos([v('cnl-pt', 'cnl', 'Cannellini')], [{ productId: 'bean', colorwayId: 'blk', imageUrl: 'https://cdn/blk.jpg' }], [])
  assert.equal(found.size, 0)
})
