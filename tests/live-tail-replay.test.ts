import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPractice, checkWire, TOLERANCE, type PracticeTurn, type WireRun } from '../scripts/live-tail-checks'

// The live-tail validator's claims (scripts/live-tail-checks.ts), held
// against numbers shaped like a real run, then broken one at a time: a
// validator that cannot fail proves nothing. Synthetic numbers only.

const good: WireRun = {
  warm: { read: 58_000, write: 42_000, cost: 0.222 },
  same: { read: 100_000, write: 0, cost: 0.021 },
  tailEdit: { read: 89_000, write: 11_050, cost: 0.073 },
  headEdit: { read: 58_000, write: 42_100, cost: 0.222 },
  offWarm: { read: 58_000, write: 42_000, cost: 0.222 },
  offTailEdit: { read: 58_000, write: 42_050, cost: 0.222 },
  tokens: { head: 31_000, tail: 11_000, live: 42_000 },
}
const failing = (r: WireRun) => checkWire(r).filter((c) => !c.ok).map((c) => c.claim.split(':')[0])
const with_ = (patch: Partial<Omit<WireRun, 'tokens'>> & { tokens?: Partial<WireRun['tokens']> }): WireRun =>
  ({ ...good, ...patch, tokens: { ...good.tokens, ...patch.tokens } }) as WireRun

test('a run that behaves as designed passes all four wire claims', () => {
  const claims = checkWire(good)
  assert.equal(claims.length, 4)
  assert.ok(claims.every((c) => c.ok), JSON.stringify(claims.filter((c) => !c.ok)))
  for (const c of claims) assert.ok(c.detail.length > 0)
})

test('identical second request: any write, or no read, fails', () => {
  assert.equal(TOLERANCE.identicalMaxWrite, 0)
  assert.deepEqual(failing(with_({ same: { read: 100_000, write: 1, cost: 0.02 } })), ['identical second request'])
  assert.deepEqual(failing(with_({ same: { read: 0, write: 0, cost: 0.4 } })), ['identical second request'])
  assert.deepEqual(failing(with_({ same: { read: 90_000, write: 0, cost: 0.02 } })), ['identical second request'], 'reads back under 98% of the cached prefix')
})

test('tail-only edit: not small enough, or not cheaper, than the tail-off control fails', () => {
  assert.deepEqual(failing(with_({ tailEdit: { read: 70_000, write: 25_000, cost: 0.14 } })), ['tail-only edit'], 'over half the control')
  assert.deepEqual(failing(with_({ tailEdit: { read: 89_000, write: 11_050, cost: 0.23 } })), ['tail-only edit'], 'costs more')
  assert.deepEqual(failing(with_({ tailEdit: { read: 100_000, write: 0, cost: 0.02 } })), ['tail-only edit'], 'wrote nothing: the edit never reached the API')
})

test('head edit: no larger than the tail-only edit, or short of head and tail, fails', () => {
  assert.ok(failing(with_({ headEdit: { read: 89_000, write: 11_000, cost: 0.07 } })).includes('head edit'))
  assert.deepEqual(failing(with_({ headEdit: { read: 70_000, write: 30_000, cost: 0.17 } })), ['head edit'], 'covers only the head')
})

test('tail-off edit: anything short of rewriting the live block fails', () => {
  assert.ok(failing(with_({ offTailEdit: { read: 90_000, write: 12_000, cost: 0.08 } })).includes('tail-off edit'))
})

const turn = (layout: 'off' | 'tail', kind: string, over: Partial<PracticeTurn> = {}): PracticeTurn =>
  ({ layout, kind, stopReason: 'complete', reply: 'Here is what I would do.', tailApplied: layout === 'tail', writesRun: [], ...over })
const kinds = ['stock write', 'PO receipt', 'to-do', 'support lookup', 'inventory lookup']
const allTurns = (['off', 'tail'] as const).flatMap((l) => kinds.map((k) => turn(l, k)))

test('practice: ten finished turns, nothing changed, each on its layout, pass', () => {
  const claims = checkPractice(allTurns, kinds)
  assert.equal(claims.length, 10)
  assert.ok(claims.every((c) => c.ok))
})

test('practice: a write that ran, an unfinished turn, an empty reply, the wrong layout or a missing turn fails', () => {
  const swap = (k: number, t: PracticeTurn) => allTurns.map((x, i) => (i === k ? t : x))
  const bad = (ts: PracticeTurn[]) => checkPractice(ts, kinds).filter((c) => !c.ok).length
  assert.equal(bad(swap(0, turn('off', 'stock write', { writesRun: ['log_inventory_event'] }))), 1)
  assert.equal(bad(swap(1, turn('off', 'PO receipt', { stopReason: 'budget' }))), 1)
  assert.equal(bad(swap(2, turn('off', 'to-do', { reply: '  ' }))), 1)
  assert.equal(bad(swap(5, turn('tail', 'stock write', { tailApplied: false }))), 1)
  assert.equal(bad(allTurns.slice(1)), 1)
})
