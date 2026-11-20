import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jwtVerify } from 'jose'
import { MAX_AGE, RENEW_AFTER, shouldRenew, signSession, sessionSecret } from '../lib/session-core'

// 20 Nov 2026: Cleo and Jane were signed out every 30 days however often they
// used the app. The session now renews on use.

process.env.SESSION_SECRET ||= 'test-secret-for-session-sliding-0123456789'

test('a session older than a day is renewed; a fresh one is left alone', () => {
  const now = 1_800_000_000
  assert.equal(shouldRenew({ iat: now - 60 }, now), false)
  assert.equal(shouldRenew({ iat: now - RENEW_AFTER }, now), true)
  assert.equal(shouldRenew({ iat: now - 29 * 86400 }, now), true)
  assert.equal(shouldRenew({}, now), true)
})

test('a renewed session keeps the person and lasts the full period again', async () => {
  const t = await signSession('per_cleo')
  const { payload } = await jwtVerify(t, sessionSecret())
  assert.equal(payload.sub, 'per_cleo')
  assert.equal((payload.exp as number) - (payload.iat as number), MAX_AGE)
  assert.ok(MAX_AGE >= 180 * 86400)
  const anon = await jwtVerify(await signSession(), sessionSecret())
  assert.equal(anon.payload.sub, undefined)
})
