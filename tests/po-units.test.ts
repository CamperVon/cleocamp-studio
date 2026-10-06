import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unitsPerLineUnit } from '../lib/po-units'

const sticker = { unitOfMeasure: 'sticker', purchaseUnit: 'roll', unitsPerPurchaseUnit: '500' }

test('a line in rolls converts to the stickers the stock counts in', () => {
  assert.equal(unitsPerLineUnit('roll (500/roll)', sticker), 500)
  assert.equal(unitsPerLineUnit('roll (Number 1, 1000/roll)', { unitOfMeasure: 'sticker' }), 1000)
  assert.equal(unitsPerLineUnit('rolls', sticker), 500)
})

test('the same unit, or one nothing explains, is taken as it is', () => {
  assert.equal(unitsPerLineUnit('stickers', sticker), 1)
  assert.equal(unitsPerLineUnit('yards', { unitOfMeasure: 'yard' }), 1)
  assert.equal(unitsPerLineUnit('pcs', { unitOfMeasure: 'pcs' }), 1)
  assert.equal(unitsPerLineUnit('box', { unitOfMeasure: 'bag' }), 1)
  assert.equal(unitsPerLineUnit('roll', null), 1)
})
