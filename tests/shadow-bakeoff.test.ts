import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { CAP_USD, EST_TURN_USD, Ledger, LATEST_START_MS, report, restFits, runCheck, stepFailure, turnsIn, worstCaseUsd, type Scenario, type TurnResult } from '../lib/mouse/shadow-bakeoff-judge'
import { resetBakeoffForTests, shadowBakeoffStep, type BakeoffRow, type BakeoffState, type BakeoffStore } from '../lib/mouse/shadow-bakeoff'
import { costOf, PRICES } from '../lib/mouse/prices'
import { runLoop } from '../lib/mouse/runner'

const OPUS = 'claude-opus-5-5'
const LOOKUPS = new Set(['open_record', 'query_status', 'open_email'])

test('a request\'s worst case is never below what it can be billed', () => {
  for (const [input, write, write1h, read, out] of [[361, 26500, 26488, 0, 4], [200, 0, 0, 110000, 1200], [9000, 101000, 0, 0, 16000], [5, 120000, 120000, 0, 16000]]) {
    const counted = input + write + read
    const billed = costOf({ model: OPUS, inputTokens: input, outputTokens: out, cacheReadTokens: read, cacheWriteTokens: write, cacheWrite1hTokens: write1h })!
    assert.ok(worstCaseUsd(OPUS, counted, 16000) >= billed, `${counted} in, ${out} out`)
  }
  assert.equal(worstCaseUsd('some-unpriced-model', 10, 10), Infinity, 'a model the cap cannot price is never sent')
  assert.equal(worstCaseUsd(OPUS, 110000, 16000), (110000 * PRICES[OPUS].w1h + 16000 * PRICES[OPUS].out) / 1e6)
})

test('the ledger: spent plus everything reserved can never pass the cap', () => {
  const l = new Ledger(9)
  assert.ok(l.reserve(0.6))
  assert.equal(l.reserve(0.5), false, '9 + 0.6 + 0.5 would pass $10')
  assert.match(l.tripped!, /spend cap/)
  l.settle(0.6, 0.2)
  assert.equal(l.spent.toFixed(2), '9.20')
  const f = new Ledger(0)
  assert.ok(f.reserve(1))
  f.settle(1, null)
  assert.equal(f.spent, 1, 'a request that failed counts at its worst case: it may still be billed')
})

const scenario = (id: string, turns = 1): Scenario => ({ id, kind: id, turns: Array.from({ length: turns }, (_, i) => `${id} turn ${i + 1}?`), check: null, fixture: id })
const SET = [scenario('lookup'), scenario('notes'), scenario('inventory'), scenario('po-receipt'), scenario('email'), scenario('multi-round', 2)]

test('the planned set fits before anything is spent; a set that cannot fit is refused', () => {
  assert.equal(turnsIn(SET), 14, '7 turns a layout, both layouts')
  const fit = restFits(0, turnsIn(SET))
  assert.ok(fit.ok, fit.detail)
  assert.equal(fit.estimate.toFixed(4), (14 * EST_TURN_USD).toFixed(4))
  assert.equal(restFits(0, 20).ok, false, `20 turns at $${EST_TURN_USD} is over $${CAP_USD}`)
  assert.equal(restFits(8, 4).ok, false, 'late in the run, the rest must still fit')
})

const turn = (layout: 'live-tail' | 'transient', over: Partial<TurnResult> = {}): TurnResult => ({
  layout, turn: 0, text: 'There are 12.', stopReason: 'complete', providerError: null, calls: [], wallMs: 1000, check: null, costUsd: 0.3,
  requests: [{ model: OPUS, inputTokens: 300, outputTokens: 100, cacheReadTokens: 20000, cacheWriteTokens: 1000, cacheWrite1hTokens: 0, costUsd: 0.3, worstCaseUsd: 1, countedInputTokens: 21300, durationMs: 900, toolRounds: 0 }],
  ...over,
})

test('a step fails on any write that ran, or any turn that did not complete', () => {
  assert.equal(stepFailure([turn('live-tail'), turn('transient')], LOOKUPS), null)
  assert.match(stepFailure([turn('live-tail', { calls: [{ name: 'log_inventory_event', status: 'succeeded', stopped: false, ran: true, input: {}, resultChars: 9 }] })], LOOKUPS)!, /write risk: live-tail ran log_inventory_event/)
  assert.equal(stepFailure([turn('transient', { calls: [{ name: 'log_inventory_event', status: 'succeeded', stopped: true, ran: false, input: {}, resultChars: 9 }] })], LOOKUPS), null, 'stopped by practice is the design')
  assert.match(stepFailure([turn('transient', { stopReason: 'provider_error', providerError: 'spend cap' })], LOOKUPS)!, /did not complete \(provider_error: spend cap\)/)
})

test('fact checks are reported, never a quality verdict', () => {
  assert.deepEqual(runCheck({ type: 'mentions', pattern: '\\b12\\b', what: 'the count' }, { text: 'There are 12.', calls: [] }), { ok: true, detail: 'says the count' })
  const stopped = [{ name: 'log_inventory_event', status: 'succeeded', stopped: true, ran: false, input: { productVariantId: 'v1', type: 'COUNTED' }, resultChars: 0 }]
  assert.equal(runCheck({ type: 'wouldHave', tool: 'log_inventory_event', match: { productVariantId: 'v1' }, orAsks: true, what: 'x' }, { text: 'Practice: done', calls: stopped })!.ok, true)
  assert.equal(runCheck({ type: 'wouldHave', tool: 'log_inventory_event', match: { productVariantId: 'v2' }, orAsks: true, what: 'x' }, { text: 'Which size?', calls: [] })!.detail, 'asked before acting')
  const r = report(SET, [{ index: 0, scenarioId: 'lookup', startedAt: '', finishedAt: '', codeVersion: 'abc', deploymentId: null, flags: { liveTailFlag: true, transientFlag: false, catalogIndex: false, inventoryWrites: true }, turns: [turn('live-tail', { costUsd: 0.4 }), turn('transient', { costUsd: 0.2 })], failure: null }], 0.6, null)
  assert.match(r.quality, /NOT JUDGED/)
  assert.equal(r.status, 'incomplete')
  assert.equal(r.transientVsLiveTail.costPerCompletedTurn, 0.5)
  assert.match(r.nextStep, /enable transient state for a controlled canary, or abandon it/)
})

// ── The step machine, against an in-memory row ─────────────────────────────

function memory(): BakeoffStore & { row: (BakeoffRow & { error?: string | null }) | null; saves: string[] } {
  const m = {
    row: null as (BakeoffRow & { error?: string | null }) | null, saves: [] as string[],
    async read() { return m.row },
    async claimNew(state: BakeoffState) { if (m.row) return false; m.row = { status: 'RUNNING', resultJson: state, startedAt: new Date(T0) }; return true },
    async claimNext(state: BakeoffState) { if (m.row?.status !== 'WAITING') return false; m.row = { ...m.row, status: 'RUNNING', resultJson: state }; return true },
    async failStale(state: BakeoffState, error: string) { if (m.row?.status !== 'RUNNING') return false; m.row = { ...m.row, status: 'FAILED', resultJson: state, error }; return true },
    async save(status: string, state: BakeoffState, error: string | null) { m.saves.push(status); m.row = { ...m.row!, status, resultJson: state, error } },
  }
  return m
}
const T0 = Date.parse('2026-10-17T16:00:00Z')
const PROD = { vercelEnv: 'production', commit: 'c0ffee', deploymentId: 'dpl_1' }
const fakeRun = (cost = 0.25, over: Partial<TurnResult> = {}) => async ({ scenario: s, ledger }: { scenario: Scenario; ledger: Ledger }) => {
  const out: TurnResult[] = []
  for (const layout of ['live-tail', 'transient'] as const) for (const [i] of s.turns.entries()) {
    if (!ledger.reserve(1)) throw new Error(ledger.tripped!)
    ledger.settle(1, cost)
    out.push(turn(layout, { turn: i, costUsd: cost, ...over }))
  }
  return out
}
const step = (store: BakeoffStore, o: Partial<Parameters<typeof shadowBakeoffStep>[0]> = {}) =>
  shadowBakeoffStep({ requestStartedAt: T0, now: () => T0 + 30_000, env: PROD, store, plan: async () => ({ scenarios: SET, missing: [] }), runScenario: fakeRun(), lookUps: LOOKUPS, ...o })

beforeEach(() => resetBakeoffForTests())

test('one scenario per completed chat, both layouts, until the set is COMPLETE; then never again', async () => {
  const store = memory()
  let ran = 0
  const runScenario = async (a: Parameters<ReturnType<typeof fakeRun>>[0]) => { ran++; return fakeRun()(a) }
  for (let i = 0; i < SET.length - 1; i++) assert.equal(await step(store, { runScenario }), 'stepped')
  assert.equal(store.row!.status, 'WAITING')
  assert.equal(await step(store, { runScenario }), 'complete')
  assert.equal(store.row!.status, 'COMPLETE')
  assert.equal(ran, SET.length)
  const st = store.row!.resultJson as BakeoffState
  assert.equal(st.steps.length, SET.length)
  assert.equal(st.spentUsd.toFixed(2), (14 * 0.25).toFixed(2))
  assert.equal(await step(store, { runScenario }), 'settled', 'this instance never asks again')
  resetBakeoffForTests()
  assert.equal(await step(store, { runScenario }), 'settled', 'nor does a fresh instance: the row says COMPLETE')
  assert.equal(ran, SET.length)
})

test('nothing off production, nothing after a slow turn, nothing while another step runs', async () => {
  const store = memory()
  assert.equal(await step(store, { env: { vercelEnv: 'preview' } }), 'not-production')
  assert.equal(await step(store, { now: () => T0 + LATEST_START_MS + 1 }), 'late')
  assert.equal(store.row, null, 'neither claimed anything')
  store.row = { status: 'RUNNING', resultJson: { stepStartedAt: new Date(T0).toISOString() }, startedAt: new Date(T0) }
  assert.equal(await step(store), 'busy')
})

test('a step cut off mid-way fails the bake-off; it is never resumed', async () => {
  const store = memory()
  store.row = { status: 'RUNNING', resultJson: { stepStartedAt: new Date(T0 - 11 * 60_000).toISOString(), steps: [], scenarios: SET }, startedAt: new Date(T0 - 3600_000) }
  assert.equal(await step(store), 'stale-failed')
  assert.equal(store.row!.status, 'FAILED')
  assert.match(store.row!.error!, /cut off/)
})

test('a set that cannot fit, or a missing fixture, stops before any spend', async () => {
  let ran = 0
  const big = Array.from({ length: 12 }, (_, i) => scenario(`s${i}`))
  const store = memory()
  assert.equal(await step(store, { plan: async () => ({ scenarios: big, missing: [] }), runScenario: async () => { ran++; return [] } }), 'cannot-fit')
  assert.equal(store.row!.status, 'FAILED')
  assert.match(store.row!.error!, /cannot fit under the cap, nothing was run/)
  resetBakeoffForTests()
  const s2 = memory()
  assert.equal(await step(s2, { plan: async () => ({ scenarios: SET, missing: ['no overdue open PO'] }), runScenario: async () => { ran++; return [] } }), 'cannot-fit')
  assert.match(s2.row!.error!, /incomplete, nothing was run: no overdue open PO/)
  assert.equal(ran, 0)
})

test('any failure ends it for good: a write that ran, the cap, a thrown error', async () => {
  const wrote = memory()
  assert.equal(await step(wrote, { runScenario: fakeRun(0.25, { calls: [{ name: 'add_note', status: 'succeeded', stopped: false, ran: true, input: {}, resultChars: 1 }] }) }), 'failed')
  assert.equal(wrote.row!.status, 'FAILED')
  assert.match(wrote.row!.error!, /write risk/)
  resetBakeoffForTests()
  assert.equal(await step(wrote), 'settled', 'not retried')

  resetBakeoffForTests()
  const capped = memory()
  // Spent so far near the cap: the next reservation cannot fit, so no request goes.
  capped.row = { status: 'WAITING', resultJson: { phase: 'waiting', scenarios: SET, steps: [], spentUsd: 9.6, stepStartedAt: null, plannedAt: new Date(T0).toISOString(), estimate: null }, startedAt: new Date(T0) }
  assert.equal(await step(capped), 'cannot-fit', 'the rest of the set no longer fits: stopped before spending on it')
  resetBakeoffForTests()
  const tripped = memory()
  tripped.row = { status: 'WAITING', resultJson: { phase: 'waiting', scenarios: [scenario('lookup')], steps: [], spentUsd: 8.9, stepStartedAt: null, plannedAt: new Date(T0).toISOString(), estimate: null }, startedAt: new Date(T0) }
  assert.equal(await step(tripped), 'failed', 'the rest fits on estimate ($8.90 + 2 × $0.53), but the second $1 worst case would pass $10: never sent')
  assert.match(tripped.row!.error!, /spend cap/)
  assert.ok((tripped.row!.resultJson as BakeoffState).spentUsd <= CAP_USD)

  resetBakeoffForTests()
  const threw = memory()
  assert.equal(await step(threw, { runScenario: async () => { throw new Error('deadline reached before this request') } }), 'failed')
  assert.match(threw.row!.error!, /deadline/)
})

test('two instances after the same chat: exactly one runs the step', async () => {
  const store = memory()
  let ran = 0
  const runScenario = async (a: Parameters<ReturnType<typeof fakeRun>>[0]) => { ran++; return fakeRun()(a) }
  const [a, b] = await Promise.all([step(store, { runScenario }), (async () => { resetBakeoffForTests(); return step(store, { runScenario }) })()])
  assert.ok([a, b].includes('stepped') && [a, b].some((x) => x === 'lost-race' || x === 'busy'), `${a} / ${b}`)
  assert.equal(ran, 1)
})

test('with retries off, a request the server refused is never sent again', async () => {
  let sent = 0
  const r = await runLoop({
    create: async () => { sent++; throw Object.assign(new Error('overloaded'), { status: 529 }) },
    system: [], messages: [{ role: 'user', content: 'hi' }], tools: [], execute: async () => null, model: OPUS,
    retryProvider: false, sleep: async () => {},
  })
  assert.equal(sent, 1)
  assert.equal(r.usage.stopReason, 'provider_error')
})
