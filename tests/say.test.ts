import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mintSayToken, tokenFromRequest, spokenLine } from '../lib/say-core'

test('a minted token is long and url-safe', () => {
  const t = mintSayToken()
  assert.ok(t.length >= 43, `too short: ${t.length}`)
  assert.match(t, /^[A-Za-z0-9_-]+$/, 'must survive a URL and a header untouched')
  assert.notEqual(mintSayToken(), t)
})

test('the token is read from a header before a query string', () => {
  const req = (init: RequestInit & { url?: string }) =>
    new Request(init.url ?? 'https://x.test/api/say', init)
  assert.equal(tokenFromRequest(req({ headers: { authorization: 'Bearer abc123' } })), 'abc123')
  assert.equal(tokenFromRequest(req({ headers: { 'x-say-token': 'abc123' } })), 'abc123')
  assert.equal(tokenFromRequest(req({ url: 'https://x.test/api/say?k=abc123' })), 'abc123')
  assert.equal(
    tokenFromRequest(req({ url: 'https://x.test/api/say?k=fromurl', headers: { authorization: 'Bearer fromheader' } })),
    'fromheader',
    'a header beats the query string, so the link can stop carrying it',
  )
  assert.equal(tokenFromRequest(req({})), null)
})

test('what comes back is short enough to hear at a light', () => {
  assert.equal(
    spokenLine("Noted. The cotton is at Antonio's now. I also moved the run date. And another thing."),
    "Noted. The cotton is at Antonio's now.",
  )
  assert.equal(spokenLine('**Got** it — `recorded`.'), 'Got it — recorded.', 'no markdown reaches a speaker')
  assert.equal(spokenLine('   '), 'Got it.', 'never returns silence')
  assert.equal(spokenLine('one long clause with no full stop at all'), 'one long clause with no full stop at all')
  assert.ok(spokenLine('x. '.repeat(400)).length <= 320, 'bounded however long the reply runs')
})
