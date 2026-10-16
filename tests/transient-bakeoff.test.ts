import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkProjection, checkQuality, checkSafety, checkSize, checkWrites, TARGET, type TurnRun } from '../scripts/transient-bakeoff-checks'

const req = (o: Partial<TurnRun['requests'][number]> = {}) => ({ model: 'claude-opus-5-5', inputTokens: 5000, outputTokens: 500, cacheReadTokens: 70000, cacheWriteTokens: 3000, cacheWrite1hTokens: 0, ...o })
const run = (o: Partial<TurnRun>): TurnRun => ({ layout: 'transient', kind: 'k', heavy: false, text: 'ok', stopReason: 'complete', calls: [], requests: [req()], cost: 0.2, check: { ok: true, detail: 'fine' }, ...o })

test('safety fails on any write that ran, and counts the ones practice stopped', () => {
  assert.equal(checkSafety([run({ calls: [{ name: 'log_inventory_event', status: 'succeeded', isWrite: true, skippedPractice: true, input: {} }] })]).ok, true)
  assert.equal(checkSafety([run({ calls: [{ name: 'add_note', status: 'succeeded', isWrite: true, skippedPractice: false, input: {} }] })]).ok, false)
})

test('a regression is a check live-tail passes and transient fails; a shared failure is information, not a regression', () => {
  const pass = { ok: true, detail: 'p' }, fail = { ok: false, detail: 'f' }
  const both = (a: typeof pass, b: typeof pass, kind = 'k') => [run({ layout: 'live-tail', kind, check: a }), run({ layout: 'transient', kind, check: b })]
  assert.equal(checkQuality(both(pass, fail))[0].ok, false)
  assert.equal(checkQuality(both(fail, fail))[0].ok, true)
  assert.equal(checkQuality(both(fail, pass))[0].ok, true)
  assert.match(checkQuality(both(fail, fail))[2].detail, /live-tail\/k: f \| transient\/k: f/)
  assert.equal(checkQuality([...both(pass, pass), run({ layout: 'transient', kind: 'x', stopReason: 'budget' }), run({ layout: 'live-tail', kind: 'x' })])[1].ok, false)
})

test('size is averaged over normal turns only, from the measured tokens', () => {
  const turns = [
    run({ requests: [req({ transientTokens: 6000 }), req({ transientTokens: 7000 })] }),
    run({ heavy: true, requests: [req({ transientTokens: 12000 })] }),
  ]
  const c = checkSize(turns)
  assert.equal(c.ok, true)
  assert.match(c.detail, /normal turns: 2 requests, average 6500, max 7000; all turns: average 8333, max 12000/)
  assert.equal(checkSize([run({ requests: [req({ transientTokens: TARGET.maxAvgTransientTokens + 1 })] })]).ok, false)
  assert.equal(checkSize([run({ requests: [req()] })]).ok, false, 'no measurement is not a pass')
})

test('writes must halve on the same turns', () => {
  const t = (live: number, tr: number) => [run({ layout: 'live-tail', requests: [req({ cacheWriteTokens: live })] }), run({ layout: 'transient', requests: [req({ cacheWriteTokens: tr })] })]
  assert.equal(checkWrites(t(10000, 5000)).ok, true)
  assert.equal(checkWrites(t(10000, 5001)).ok, false)
})

test('the projection scales production\'s real cost by the replay\'s real ratio', () => {
  const t = [run({ layout: 'live-tail', cost: 1.0 }), run({ layout: 'transient', cost: 0.7 })]
  const c = checkProjection(t, 0.42, 66)
  assert.equal(c.ok, true)
  assert.match(c.detail, /ratio 0\.700.*\$0\.420 per completed reply over 66 replies → projected \$0\.294/)
  assert.equal(checkProjection([run({ layout: 'live-tail', cost: 1.0 }), run({ layout: 'transient', cost: 0.8 })], 0.42, 66).ok, false)
})
