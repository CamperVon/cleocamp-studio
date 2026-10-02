import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QUOTES, quoteOfTheDay } from '../lib/quotes'

test('no quote twice in the list', () => {
  assert.equal(new Set(QUOTES.map((q) => q.text)).size, QUOTES.length)
})

test('every quote shows once before any repeats, across month and year ends', () => {
  const start = new Date('2026-10-25T19:00:00Z')
  const seen = new Set<string>()
  for (let i = 0; i < QUOTES.length; i++) seen.add(quoteOfTheDay(new Date(start.getTime() + i * 864e5)).text)
  assert.equal(seen.size, QUOTES.length)
})

test('stable through an LA day, including the evening after UTC midnight', () => {
  assert.equal(quoteOfTheDay(new Date('2026-10-02T15:00:00Z')).text, quoteOfTheDay(new Date('2026-10-03T06:00:00Z')).text)
})
