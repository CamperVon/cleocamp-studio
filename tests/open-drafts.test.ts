import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftMatches, type OpenDraft } from '../lib/live-sale'
import { TOOL_KINDS } from '../lib/mouse/tool-kinds'

const d82: OpenDraft = {
  name: '#D82', email: 'hello@shopcosimo.com', customer: 'Emily Morabito Lacey', total: 997,
  tags: ['ships', 'studio-mouse', 'wholesale'], createdAt: '2026-11-23T19:33:19Z',
}

test('a store name finds its draft through the email address', () => {
  assert.equal(draftMatches(d82, 'Cosimo'), true)
  assert.equal(draftMatches(d82, 'the cosimo invoice'.replace('the ', '').replace(' invoice', '')), true)
})

test('the customer name, the email and the D number all match', () => {
  assert.equal(draftMatches(d82, 'Emily Lacey'), true)
  assert.equal(draftMatches(d82, 'hello@shopcosimo.com'), true)
  assert.equal(draftMatches(d82, '#D82'), true)
})

test('another store does not match, and no query matches everything', () => {
  assert.equal(draftMatches(d82, 'Grandpa'), false)
  assert.equal(draftMatches(d82, ''), true)
})

test('open_drafts is a look-up', () => {
  assert.equal(TOOL_KINDS.open_drafts, 'look-up, Opus')
})
