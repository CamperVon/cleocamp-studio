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

test('a line in packs "of 2,000" converts, read from the line or from the purchase unit (PO 2407)', () => {
  const labels = { unitOfMeasure: 'label', purchaseUnit: 'pack of 2,000', unitsPerPurchaseUnit: '2000' }
  assert.equal(unitsPerLineUnit('packs of 2,000', labels), 2000)
  assert.equal(unitsPerLineUnit('pack of 2000 labels', { unitOfMeasure: 'label' }), 2000, 'from the line alone')
  assert.equal(unitsPerLineUnit('packs', labels), 2000, 'from the purchase unit by its first word')
  assert.equal(unitsPerLineUnit('box of 12', { unitOfMeasure: 'pcs' }), 12)
  assert.equal(unitsPerLineUnit('roll of 50 yards', { unitOfMeasure: 'yard' }), 50)
})

test('an "of" size in a different unit from the stock is not taken', () => {
  assert.equal(unitsPerLineUnit('case of 12 boxes', { unitOfMeasure: 'pcs' }), 1)
  assert.equal(unitsPerLineUnit('labels', { unitOfMeasure: 'label', purchaseUnit: 'pack of 2,000', unitsPerPurchaseUnit: '2000' }), 1)
})
