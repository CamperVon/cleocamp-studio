import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allClaims, checkHumanReview, checkProjection, checkRequired, checkSafety, checkSize, checkWrites, churnSchedule, TARGET, type TurnRun } from '../scripts/transient-bakeoff-checks'

const req = (o: Partial<TurnRun['requests'][number]> = {}) => ({ model: 'claude-opus-5-5', inputTokens: 5000, outputTokens: 500, cacheReadTokens: 70000, cacheWriteTokens: 3000, cacheWrite1hTokens: 0, ...o })
const run = (o: Partial<TurnRun>): TurnRun => ({ layout: 'transient', kind: 'k', text: 'ok', stopReason: 'complete', calls: [], requests: [req({ transientTokens: 5000, transientChars: 9000 })], cost: 0.2, check: { ok: true, detail: 'fine' }, ...o })
const pass = { ok: true, detail: 'p' }, fail = { ok: false, detail: 'f' }
const pair = (a: TurnRun['check'], b: TurnRun['check'], kind = 'k') => [run({ layout: 'live-tail', kind, check: a }), run({ layout: 'transient', kind, check: b })]

test('churn is production\'s proportion: 13 turns get 4 head changes and 1 tail-only, spread, never the first', () => {
  const s = churnSchedule(13)
  const v = Object.values(s)
  assert.equal(v.filter((x) => x === 'head').length, 4)
  assert.equal(v.filter((x) => x === 'tail').length, 1)
  assert.ok(!(0 in s))
  assert.deepEqual(Object.keys(s).map(Number), [2, 4, 7, 9, 11])
  // 36 turns reproduce production exactly.
  const full = Object.values(churnSchedule(36))
  assert.deepEqual([full.filter((x) => x === 'head').length, full.filter((x) => x === 'tail').length], [11, 3])
})

test('safety fails on any write that ran', () => {
  assert.equal(checkSafety([run({ calls: [{ name: 'log_inventory_event', status: 'succeeded', isWrite: true, skippedPractice: true, input: {}, resultChars: 10 }] })]).ok, true)
  assert.equal(checkSafety([run({ calls: [{ name: 'add_note', status: 'succeeded', isWrite: true, skippedPractice: false, input: {}, resultChars: 10 }] })]).ok, false)
})

test('a required check must pass in BOTH layouts: a shared failure is a failure, and a missing fixture fails', () => {
  assert.equal(checkRequired(pair(pass, pass))[0].ok, true)
  assert.equal(checkRequired(pair(pass, fail))[0].ok, false)
  assert.equal(checkRequired(pair(fail, fail))[0].ok, false, 'never excused because live-tail failed too')
  assert.equal(checkRequired(pair(fail, pass))[0].ok, false)
  assert.equal(checkRequired([run({ layout: 'live-tail', fixtureMissing: 'no W-9 kept', check: null }), run({ fixtureMissing: 'no W-9 kept', check: null })])[0].ok, false)
  assert.equal(checkRequired([...pair(pass, pass), run({ kind: 'x', stopReason: 'budget' })])[1].ok, false)
})

test('human review covers every pair and is pending until it does', () => {
  const turns = [...pair(pass, pass, 'a'), ...pair(null, null, 'b')]
  assert.match(checkHumanReview(turns, null).detail, /^PENDING/)
  assert.equal(checkHumanReview(turns, { a: { verdict: 'ok' } }).ok, false)
  assert.equal(checkHumanReview(turns, { a: { verdict: 'ok' }, b: { verdict: null } }).ok, false)
  assert.equal(checkHumanReview(turns, { a: { verdict: 'ok' }, b: { verdict: 'worse', notes: 'vaguer' } }).ok, false)
  assert.equal(checkHumanReview(turns, { a: { verdict: 'ok' }, b: { verdict: 'ok' } }).ok, true)
})

test('size counts only counted tokens; one uncounted request is not a pass', () => {
  const ok = checkSize([run({ requests: [req({ transientTokens: 6000, transientChars: 11000 }), req({ transientTokens: 7000, transientChars: 12000 })] })])
  assert.equal(ok.ok, true)
  assert.match(ok.detail, /2 of 2 requests counted; average 6500, max 7000; 1.77 characters a token/)
  assert.equal(checkSize([run({ requests: [req({ transientTokens: 6000 }), req({ transientChars: 9000 })] })]).ok, false)
  assert.equal(checkSize([run({ requests: [req({ transientTokens: TARGET.maxAvgTransientTokens + 1 })] })]).ok, false)
  // Never read off input_tokens.
  assert.equal(checkSize([run({ requests: [req({ inputTokens: 100, transientChars: 9000 })] })]).ok, false)
})

test('writes must halve on the same turns, and tool-result size is reported', () => {
  const t = (live: number, tr: number) => [run({ layout: 'live-tail', requests: [req({ cacheWriteTokens: live })] }), run({ layout: 'transient', requests: [req({ cacheWriteTokens: tr })], calls: [{ name: 'list_records', status: 'succeeded', skippedPractice: false, input: {}, resultChars: 2500 }] })]
  assert.equal(checkWrites(t(10000, 5000)).ok, true)
  assert.equal(checkWrites(t(10000, 5001)).ok, false)
  assert.match(checkWrites(t(10000, 5000)).detail, /tool results: transient 2,500 chars \(largest 2,500\)/)
})

test('the projection scales production\'s real cost by the replay\'s real ratio', () => {
  const c = checkProjection([run({ layout: 'live-tail', cost: 1.0 }), run({ layout: 'transient', cost: 0.7 })], 0.42, 66)
  assert.equal(c.ok, true)
  assert.match(c.detail, /ratio 0\.700.*\$0\.420 per completed reply over 66 replies → projected \$0\.294/)
  assert.equal(checkProjection([run({ layout: 'live-tail', cost: 1.0 }), run({ layout: 'transient', cost: 0.8 })], 0.42, 66).ok, false)
})

test('acceptance needs every claim, the human review included', () => {
  const turns = pair(pass, pass)
  const without = allClaims(turns, { productionPerReply: 0.42, productionReplies: 66, review: null })
  assert.ok(without.some((c) => !c.ok && /human review/.test(c.claim)))
})

test('the smoke check passes only when the cache behaves as the layout assumes', async () => {
  const { judgeSmoke } = await import('../scripts/transient-bakeoff-checks')
  const u = (o: Record<string, number>) => ({ model: 'claude-opus-5-5', inputTokens: 0, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, durationMs: 1, ...o })
  const good = { cold: u({ cacheWriteTokens: 20000, cacheWrite1hTokens: 19000, inputTokens: 300 }), again: u({ cacheReadTokens: 20000, inputTokens: 305 }), next: u({ cacheReadTokens: 20000, cacheWriteTokens: 40, cacheWrite1hTokens: 30, inputTokens: 300 }), stateTokens: [300, 300], deltaTokens: 30 }
  assert.ok(judgeSmoke(good).every((c) => c.ok))
  assert.ok(!judgeSmoke({ ...good, again: u({ cacheReadTokens: 20000, cacheWriteTokens: 500, inputTokens: 305 }) }).every((c) => c.ok), 'a write on the identical prefix means the state broke the cache')
  assert.ok(!judgeSmoke({ ...good, again: u({ cacheReadTokens: 20000, inputTokens: 900 }) }).every((c) => c.ok), 'uncached input beyond the state')
  assert.ok(!judgeSmoke({ ...good, cold: u({ cacheWriteTokens: 20000, cacheWrite1hTokens: 0 }) }).every((c) => c.ok), 'one-hour marks ignored')
  assert.ok(!judgeSmoke({ ...good, next: u({ cacheReadTokens: 5000, cacheWriteTokens: 15000, cacheWrite1hTokens: 15000 }) }).every((c) => c.ok), 'history rewritten')
})
