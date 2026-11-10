import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coversEverySize } from '../lib/bom'

test('size lines that cover every size replace the all-variants line', () => {
  assert.equal(coversEverySize(['S/M', 'L/XL'], ['S/M', 'L/XL', 'S/M', 'L/XL']), true)
  assert.equal(coversEverySize(['s/m', ' L/XL '], ['S/M', 'L/XL']), true)
})

test('anything short of every size keeps the refusal', () => {
  assert.equal(coversEverySize(['L/XL'], ['S/M', 'L/XL']), false)
  assert.equal(coversEverySize(['S/M', 'L/XL'], ['S/M', 'L/XL', null]), false)
  assert.equal(coversEverySize(['One size'], []), false)
})
