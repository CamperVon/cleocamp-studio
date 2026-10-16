import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { resetShadowForTests, SHADOW_LATEST_START_MS, SHADOW_SOURCE, shadowSmokeOnce, type ShadowStore } from '../lib/mouse/shadow-smoke'
import { runTransientSmoke, SMOKE_CEILING_USD, SMOKE_MAX_TOKENS, type SmokeResult } from '../lib/mouse/transient-smoke'
import { judgeSmoke } from '../lib/mouse/transient-smoke-judge'

const PROD = { vercelEnv: 'production', commit: 'abc1234', deploymentId: 'dpl_1' }

/** One database, shared by every "instance": the claim is atomic, as INSERT ... ON CONFLICT DO NOTHING is. */
function fakeDb(o: { existsThrows?: boolean; finishThrows?: boolean; existing?: boolean } = {}) {
  const s = { row: o.existing ? { status: 'PASSED' } as Record<string, unknown> | null : null, claims: 0, finishes: [] as Array<Record<string, unknown>> }
  const store: ShadowStore = {
    async exists() { if (o.existsThrows) throw new Error('relation "ShadowRun" does not exist'); return s.row !== null },
    async claim(row) { s.claims++; await new Promise((r) => setImmediate(r)); if (s.row) return false; s.row = { status: 'RUNNING', ...row }; return true },
    async finish(f) { if (o.finishThrows) throw new Error('db down'); s.finishes.push(f); s.row = { ...s.row, ...f } },
  }
  return { s, store }
}
const result = (o: Partial<SmokeResult> = {}): SmokeResult => ({ ok: true, runId: 'r', source: SHADOW_SOURCE, codeVersion: 'abc1234', model: 'claude-opus-5-5', transientStateOn: false, ceilingUsd: 0.5, spentUsd: 0.16, requests: [], usage: {}, stateTokens: [], deltaTokens: 0, realStates: [], checks: [], error: null, ...o })

test('off production nothing is claimed or run', async () => {
  resetShadowForTests()
  const { s, store } = fakeDb()
  let runs = 0
  for (const vercelEnv of [undefined, 'preview', 'development']) {
    assert.equal(await shadowSmokeOnce({ requestStartedAt: Date.now(), env: { vercelEnv }, store, run: async () => { runs++; return result() } }), 'not-production')
  }
  assert.deepEqual([runs, s.claims], [0, 0])
})

test('a chat turn that used up the headroom claims nothing; the next one runs it', async () => {
  resetShadowForTests()
  const { s, store } = fakeDb()
  let runs = 0
  const run = async () => { runs++; return result() }
  assert.equal(await shadowSmokeOnce({ requestStartedAt: 0, now: () => SHADOW_LATEST_START_MS + 1, env: PROD, store, run }), 'late')
  assert.deepEqual([runs, s.claims], [0, 0])
  assert.equal(await shadowSmokeOnce({ requestStartedAt: 0, now: () => 5_000, env: PROD, store, run }), 'passed')
  assert.equal(runs, 1)
})

test('two instances at once: one claim lands, the job runs once', async () => {
  const { s, store } = fakeDb()
  let runs = 0
  const run = async () => { runs++; return result() }
  // Two instances = two module flags; the race is on the database.
  resetShadowForTests()
  const a = shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run })
  const b = shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run })
  const outcomes = (await Promise.all([a, b])).sort()
  assert.deepEqual(outcomes, ['lost-race', 'passed'])
  assert.equal(runs, 1)
  assert.equal(s.claims, 2)
  assert.equal(s.finishes.length, 1)
})

test('once it has run, every later chat on every instance leaves it alone', async () => {
  const { store } = fakeDb({ existing: true })
  let runs = 0
  for (let i = 0; i < 3; i++) {
    resetShadowForTests() // a fresh instance each time
    assert.equal(await shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run: async () => { runs++; return result() } }), 'settled')
  }
  assert.equal(runs, 0)
})

test('a failure is recorded and never retried, on this instance or another', async () => {
  resetShadowForTests()
  const { s, store } = fakeDb()
  let runs = 0
  const boom = async (): Promise<SmokeResult> => { runs++; throw new Error('socket hang up') }
  assert.equal(await shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run: boom }), 'error')
  assert.equal(s.finishes[0].status, 'ERROR')
  assert.equal(s.finishes[0].error, 'socket hang up')
  assert.equal(await shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run: boom }), 'settled')
  resetShadowForTests()
  assert.equal(await shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run: boom }), 'settled')
  assert.equal(runs, 1)
})

test('outcomes are recorded as they are: failed checks, a refused layout, the ceiling', async () => {
  for (const [r, status, outcome] of [
    [result({ ok: false, checks: [{ check: 'x', ok: false, detail: 'd' }] }), 'FAILED', 'failed'],
    [result({ ok: false, error: { kind: 'refused', message: '400 cache_control: too many', status: 400 } }), 'ERROR', 'error'],
    [result({ ok: false, error: { kind: 'budget', message: 'over the ceiling' } }), 'ERROR', 'error'],
  ] as const) {
    resetShadowForTests()
    const { s, store } = fakeDb()
    assert.equal(await shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run: async () => r }), outcome)
    assert.equal(s.finishes[0].status, status)
    assert.deepEqual(s.finishes[0].result, r)
  }
})

test('the run gets the commit and a deadline signal', async () => {
  resetShadowForTests()
  const { store } = fakeDb()
  let seen: [AbortSignal, string | null] | null = null
  await shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run: async (signal, v) => { seen = [signal, v]; return result() } })
  assert.ok(seen![0] instanceof AbortSignal)
  assert.equal(seen![1], 'abc1234')
})

test('no lock table (migration not applied): fails closed, spends nothing', async () => {
  resetShadowForTests()
  const { store } = fakeDb({ existsThrows: true })
  let runs = 0
  assert.equal(await shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run: async () => { runs++; return result() } }), 'unavailable')
  assert.equal(runs, 0)
})

test('a result that cannot be written does not throw into the request', async () => {
  resetShadowForTests()
  const { store } = fakeDb({ finishThrows: true })
  const orig = console.error
  console.error = () => {}
  try {
    assert.equal(await shadowSmokeOnce({ requestStartedAt: Date.now(), env: PROD, store, run: async () => result() }), 'passed')
  } finally { console.error = orig }
})

// ---- the check itself, against a fake API ----

test('the smoke check passes only when the cache behaves as the layout assumes', () => {
  const u = (o: Record<string, number>) => ({ model: 'claude-opus-5-5', inputTokens: 0, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, durationMs: 1, ...o })
  const good = { cold: u({ cacheWriteTokens: 20000, cacheWrite1hTokens: 19000, inputTokens: 300 }), again: u({ cacheReadTokens: 20000, inputTokens: 305 }), next: u({ cacheReadTokens: 20000, cacheWriteTokens: 40, cacheWrite1hTokens: 30, inputTokens: 300 }), stateTokens: [300, 300], deltaTokens: 30 }
  assert.ok(judgeSmoke(good).every((c) => c.ok))
  assert.ok(!judgeSmoke({ ...good, again: u({ cacheReadTokens: 20000, cacheWriteTokens: 500, inputTokens: 305 }) }).every((c) => c.ok), 'a write on the identical prefix means the state broke the cache')
  assert.ok(!judgeSmoke({ ...good, again: u({ cacheReadTokens: 20000, inputTokens: 900 }) }).every((c) => c.ok), 'uncached input beyond the state')
  assert.ok(!judgeSmoke({ ...good, cold: u({ cacheWriteTokens: 20000, cacheWrite1hTokens: 0 }) }).every((c) => c.ok), 'one-hour marks ignored')
  assert.ok(!judgeSmoke({ ...good, next: u({ cacheReadTokens: 5000, cacheWriteTokens: 15000, cacheWrite1hTokens: 15000 }) }).every((c) => c.ok), 'history rewritten')
})

const textOf = (m: Anthropic.MessageParam) => typeof m.content === 'string' ? m.content : m.content.map((b) => ('text' in b ? b.text : '')).join('')
function fakeApi(o: { refuse?: boolean; usage?: Array<Partial<Anthropic.Usage>> } = {}) {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = []
  const usage = o.usage ?? [
    { input_tokens: 300, cache_creation_input_tokens: 20_000, cache_creation: { ephemeral_1h_input_tokens: 19_700, ephemeral_5m_input_tokens: 300 }, cache_read_input_tokens: 0 },
    { input_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 20_000 },
    { input_tokens: 300, cache_creation_input_tokens: 120, cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 20 }, cache_read_input_tokens: 20_000 },
  ]
  const client = {
    messages: {
      async countTokens(b: { messages: Anthropic.MessageParam[]; system?: unknown }) {
        if (b.system) return { input_tokens: 20_000 }
        const t = b.messages.map(textOf).join('')
        if (t === '.') return { input_tokens: 10 }
        if (t.startsWith('<business_state as_of="smoke')) return { input_tokens: 310 }
        if (t.startsWith('<real')) return { input_tokens: 5_010 }
        return { input_tokens: 100 * b.messages.length }
      },
      async create(b: Anthropic.MessageCreateParamsNonStreaming) {
        sent.push(b)
        if (o.refuse) throw Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'A maximum of 4 blocks with cache_control may be provided.' } }, undefined, new Headers())
        return { usage: { output_tokens: 1, ...usage[sent.length - 1] } }
      },
    },
  } as unknown as Anthropic
  return { client, sent }
}
const fakeCore = async () => ({ rules: 'RULES', transientRules: 'TRULES', core: 'CORE' })
const fakeState = async () => ({ text: '<real state/>', chars: 9_000 })

test('three requests, no tools, the capped max_tokens, each recorded under its source with 1h and 5m writes', async () => {
  const { client, sent } = fakeApi()
  const recorded: Array<[string, number]> = []
  const r = await runTransientSmoke({ client, source: SHADOW_SOURCE, codeVersion: 'abc1234', core: fakeCore, realState: fakeState, record: async (src, q) => { recorded.push([src, q.length]) } })
  assert.equal(r.error, null)
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)))
  assert.equal(sent.length, 3)
  for (const b of sent) {
    assert.equal('tools' in b, false)
    assert.equal(b.max_tokens, SMOKE_MAX_TOKENS)
  }
  assert.deepEqual(recorded, [[SHADOW_SOURCE, 1], [SHADOW_SOURCE, 1], [SHADOW_SOURCE, 1]])
  assert.deepEqual([r.usage.cold?.cacheWrite1hTokens, r.usage.cold?.cacheWrite5mTokens, r.usage.next?.cacheWrite5mTokens], [19_700, 300, 20])
  assert.equal(r.realStates.length, 5)
  assert.ok(r.realStates.every((s) => s.tokens === 5_000))
  assert.equal(r.codeVersion, 'abc1234')
  assert.ok(r.spentUsd > 0 && r.spentUsd <= SMOKE_CEILING_USD)
})

test('the ceiling is checked before each request at its worst case; nothing over it is sent', async () => {
  const none = fakeApi()
  const r0 = await runTransientSmoke({ client: none.client, source: 's', ceilingUsd: 0.05, core: fakeCore, realState: fakeState, record: async () => {} })
  assert.equal(none.sent.length, 0)
  assert.equal(r0.error?.kind, 'budget')
  // At $0.20 the cold request fits; the second's worst case (a full cache miss) does not.
  const one = fakeApi()
  const r1 = await runTransientSmoke({ client: one.client, source: 's', ceilingUsd: 0.2, core: fakeCore, realState: fakeState, record: async () => {} })
  assert.equal(one.sent.length, 1)
  assert.equal(r1.error?.kind, 'budget')
  assert.ok(r1.spentUsd <= 0.2)
  assert.equal(r1.ok, false)
})

test('a refused layout comes back verbatim as the finding, not a crash', async () => {
  const { client, sent } = fakeApi({ refuse: true })
  const r = await runTransientSmoke({ client, source: 's', core: fakeCore, realState: fakeState, record: async () => {} })
  assert.equal(sent.length, 1)
  assert.equal(r.ok, false)
  assert.equal(r.error?.kind, 'refused')
  assert.equal(r.error?.status, 400)
  assert.match(r.error!.message, /maximum of 4 blocks with cache_control/)
})

test('a deadline already passed stops it before anything is sent', async () => {
  const { client, sent } = fakeApi()
  const r = await runTransientSmoke({ client, source: 's', signal: AbortSignal.abort(), core: fakeCore, realState: fakeState, record: async () => {} })
  assert.equal(sent.length, 0)
  assert.equal(r.ok, false)
  assert.ok(r.error)
})

// ---- what the code is allowed to touch ----

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const WRITE = /\bdb\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|sendEmail|chatMessage/g

test('read-only: the check and everything it builds state with writes nothing and sends nothing', () => {
  for (const f of ['lib/mouse/transient-smoke.ts', 'lib/mouse/transient-smoke-judge.ts', 'lib/mouse/transient.ts', 'lib/mouse/records.ts', 'lib/mouse/context.ts', 'lib/mouse/notes.ts', 'lib/mouse/cache-blocks.ts', 'lib/mouse/prices.ts', 'lib/mouse/list-records.ts']) {
    assert.deepEqual(src(f).match(WRITE) ?? [], [], f)
  }
  // Its own accounting is the only write: ModelUsage, under the source it is given.
  assert.match(src('lib/mouse/transient-smoke.ts'), /await record\(source, \[q\]\)/)
  assert.doesNotMatch(src('lib/mouse/transient-smoke.ts'), /tools\s*:/)
})

test('the shadow job writes its own lock row and nothing else, and never sets the transient flag', () => {
  const s = src('lib/mouse/shadow-smoke.ts')
  const writes = [...s.matchAll(WRITE)].map((m) => m[1])
  assert.deepEqual([...new Set(writes)], ['shadowRun'])
  assert.doesNotMatch(s, /process\.env\.MOUSE_TRANSIENT_STATE\s*=/)
  assert.doesNotMatch(src('lib/mouse/transient-smoke.ts'), /process\.env\.\w+\s*=[^=]/)
  assert.match(s, /maxRetries: 0/)
})

test('the chat route schedules it only after a completed reply is saved, and returns the reply unchanged', () => {
  const s = src('app/api/chat/route.ts')
  const saved = s.indexOf("role: 'ASSISTANT'")
  const hook = s.indexOf("if (r.usage.stopReason === 'complete') scheduleShadowSmoke(startedAt)")
  const reply = s.indexOf('return NextResponse.json({\n    threadId: thread.id,\n    practice,')
  assert.ok(saved > 0 && hook > saved && reply > hook)
  assert.equal(s.match(/scheduleShadowSmoke\(/g)?.length, 1)
})
