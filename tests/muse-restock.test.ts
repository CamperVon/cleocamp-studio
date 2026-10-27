import assert from 'node:assert/strict'
import test from 'node:test'
import { BUY_PREFIX, restockBrief, restockCall, RESTOCK_DAYS } from '../lib/muse-restock'
import { buyNeedsTeam } from '../lib/muse'

test('a supply under two weeks of cover is handed to Muse', () => {
  const call = restockCall(5, 1, false)
  assert.equal(call.action, 'hand')
  assert.equal(restockCall(RESTOCK_DAYS + 1, 1, false).action, 'none')
})

test('a supply already with Muse is not handed twice', () => {
  assert.deepEqual(restockCall(5, 1, true), { action: 'none', why: 'already with Muse' })
})

test('a count below zero or never taken asks for a count, never a purchase', () => {
  assert.equal(restockCall(-14.84, 1, false).action, 'count')
  assert.equal(restockCall(null, 1, false).action, 'count')
})

test('no recorded use means nothing to buy yet', () => {
  assert.equal(restockCall(3, 0, false).action, 'none')
  assert.equal(restockCall(3, null, false).action, 'none')
})

test('the brief says it is a purchase, asks for approval first and carries no money figures of ours', () => {
  const b = restockBrief({ name: 'Shipping tape', unit: 'rolls', spec: 'Cheap, clear packing tape, any brand.' }, 3.4, 0.5, null)
  assert.match(b, /^PURCHASE: shipping tape/)
  assert.match(b, /Cheap, clear packing tape/)
  assert.match(b, /Buy only after one of us says yes/)
  assert.match(b, /about 3.5 rolls a week/)
  assert.match(b, /ask us for the address/)
  assert.doesNotMatch(b, /\$/)
})

test('buying questions on a buy task go to a person; other tasks are untouched', () => {
  const t = `${BUY_PREFIX}shipping tape (cheap, clear packing tape, any brand)`
  assert.equal(buyNeedsTeam(t, 'Found 36 rolls for $42 on Amazon. OK to buy?'), true)
  assert.equal(buyNeedsTeam(t, 'Can I go ahead with the Uline order?'), true)
  assert.equal(buyNeedsTeam(t, 'What address should it ship to?'), true)
  assert.equal(buyNeedsTeam(t, 'Is 2 inch wide fine?'), false)
  assert.equal(buyNeedsTeam('Cheaper source for Calamo silks', 'OK to buy a swatch?'), false)
})
