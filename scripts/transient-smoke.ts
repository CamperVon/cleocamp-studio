/**
 * Smoke check on the real API, before the bake-off (Codex review, 16 Oct
 * 2026): does Anthropic accept the transient layout's exact four-mark shape,
 * a one-hour mark on the history included, with the state after the last
 * mark, and does the cache behave as the layout assumes? A fake server
 * cannot answer that.
 *
 *   npx tsx scripts/transient-smoke.ts <outDir>
 *
 * SPENDS A LITTLE (about $0.20: three short Opus requests over the real rules
 * and core, and free token counts). Needs ANTHROPIC_API_KEY; refuses without
 * it. Changes nothing. Writes <outDir>/smoke.json, which the bake-off needs.
 *
 * The requests are built by the same functions chat uses (coreSystemBlocks,
 * layoutTransientMessages) over the real standing rules and the real stable
 * core; the tools are left out to keep it cheap (they sit ahead of the first
 * mark and do not change the marks). The history is a short made-up
 * exchange, long enough to clear the cache's minimum length.
 *
 *   1  cold: system (rules 1h, core 1h), history (1h mark), the message
 *      (5-minute mark), the state after it
 *   2  the same request with a different state: everything before the state
 *      must come back from the cache, and only the state may be uncached
 *   3  the next turn: history grown by one exchange, its mark moved down;
 *      only the new messages may be written
 *
 * Then, free: the real business state for five representative messages is
 * built and counted with the token-count endpoint. If they average over the
 * 8,000-token target, the smoke check fails, so no bake-off is paid for that
 * would miss the size gate.
 */
// This container sets ANTHROPIC_BASE_URL for its own use; the SDK would send
// these requests there. Pinned to Anthropic's public API, unless a dry run
// points MOUSE_API_BASE_URL at a local fake.
process.env.ANTHROPIC_BASE_URL = process.env.MOUSE_API_BASE_URL ?? 'https://api.anthropic.com'
import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { CHAT_MODEL } from '@/lib/mouse/agent'
import { coreSystemBlocks, layoutTransientMessages } from '@/lib/mouse/cache-blocks'
import { buildCatalogParts } from '@/lib/mouse/context'
import { SYSTEM_RULES } from '@/lib/mouse/prompt'
import { buildDirectory, buildTransientState, TRANSIENT_RULES } from '@/lib/mouse/transient'
import { prefetchForMessage } from '@/lib/mouse/records'
import { countStateTokens } from '@/lib/mouse/agent'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import { costOf } from './cost-quality-audit'
import { judgeSmoke, TARGET } from './transient-bakeoff-checks'

const SOURCE = 'transient-smoke'

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set: this smoke check calls the API. Nothing was run.')
  const outDir = process.argv[2]
  if (!outDir) throw new Error('give the bake-off folder: npx tsx scripts/transient-smoke.ts <outDir>')
  mkdirSync(outDir, { recursive: true })
  const client = new Anthropic({ maxRetries: 2 })
  const runId = new Date().toISOString()

  const [parts, directory] = await Promise.all([buildCatalogParts({ notes: 'index', catalog: 'index' }), buildDirectory()])
  const system = coreSystemBlocks({ rules: SYSTEM_RULES, transientRules: TRANSIENT_RULES, core: `${parts.stable}\n${directory}` })
  // A short made-up exchange, the same every run apart from its first line,
  // which names the run so no earlier run's cache can make a write look smaller.
  const pad = (s: string) => `${s} ${'This is filler text for the smoke check, kept to make the history long enough to cache. '.repeat(30)}`
  const history: Anthropic.MessageParam[] = [
    { role: 'user', content: pad(`Smoke run ${runId}. Morning.`) },
    { role: 'assistant', content: pad('Morning. Nothing urgent.') },
    { role: 'user', content: pad('Thanks.') },
    { role: 'assistant', content: pad('You are welcome.') },
  ]
  const ask: Anthropic.MessageParam = { role: 'user', content: 'Reply with the single word OK.' }
  const state = (n: number) => `<business_state as_of="smoke-${n}">\nReference data for the smoke check, request ${n}. ${'Row of made-up state. '.repeat(40)}\n</business_state>`
  const count = async (messages: Anthropic.MessageParam[]) => (await client.messages.countTokens({ model: CHAT_MODEL, messages })).input_tokens
  const base = await count([{ role: 'user', content: [{ type: 'text', text: '.' }] }])
  const stateTokens = [await count([{ role: 'user', content: [{ type: 'text', text: state(1) }] }]) - base, await count([{ role: 'user', content: [{ type: 'text', text: state(2) }] }]) - base]

  const send = async (label: string, messages: Anthropic.MessageParam[]) => {
    const startedAt = Date.now()
    const res = await client.messages.create({ model: CHAT_MODEL, max_tokens: 16, system, messages })
    const q = usageOf(CHAT_MODEL, res.usage, startedAt)
    await recordUsage(SOURCE, [q])
    console.log(`${label.padEnd(28)} in ${q.inputTokens} · read ${q.cacheReadTokens} · write ${q.cacheWriteTokens} (1h ${q.cacheWrite1hTokens}) · out ${q.outputTokens} · $${(costOf(q) ?? 0).toFixed(4)}`)
    return q
  }
  const turn1 = [...history, ask]
  const cold = await send('1 cold', layoutTransientMessages(turn1, history.length, state(1)))
  const again = await send('2 same turn, new state', layoutTransientMessages(turn1, history.length, state(2)))
  const grown: Anthropic.MessageParam[] = [...turn1, { role: 'assistant', content: 'OK' }]
  const ask2: Anthropic.MessageParam = { role: 'user', content: 'And once more: reply OK.' }
  const deltaTokens = await count([...grown, ask2]) - await count(turn1)
  const next = await send('3 next turn', layoutTransientMessages([...grown, ask2], grown.length, state(1)))

  // The real state, counted (free): five messages like the bake-off's.
  const samples = ['Morning, anything urgent?', 'How many Cleo Tees do we have?', 'What lining does the Story Dress use?', 'PO 2409 arrived in full today.', 'Which open purchase orders are past their due date?']
  const real: Array<{ message: string; chars: number; tokens: number | undefined }> = []
  for (const m of samples) {
    const st = await buildTransientState({ practice: true, lane: 'full', actorName: 'Brandon', inventoryWrites: true, shopifyWrites: true }, () => prefetchForMessage(m, { catalogue: true }))
    real.push({ message: m, chars: st.chars, tokens: await countStateTokens(client, CHAT_MODEL, st.text) })
  }
  for (const r of real) console.log(`state for "${r.message}": ${r.chars} chars, ${r.tokens ?? 'NOT COUNTED'} tokens`)
  const counted = real.map((r) => r.tokens).filter((n): n is number => typeof n === 'number')
  const avg = counted.length === real.length ? counted.reduce((a, b) => a + b, 0) / counted.length : Infinity

  const checks = [
    ...judgeSmoke({ cold, again, next, stateTokens, deltaTokens }),
    { check: `real state: the five sample states average ${TARGET.maxAvgTransientTokens.toLocaleString('en-US')} tokens or less, counted`, ok: avg <= TARGET.maxAvgTransientTokens, detail: `average ${Number.isFinite(avg) ? Math.round(avg) : 'not all counted'}, max ${counted.length ? Math.max(...counted) : 'n/a'}` },
  ]
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.check}\n      ${c.detail}`)
  const ok = checks.every((c) => c.ok)
  writeFileSync(join(outDir, 'smoke.json'), JSON.stringify({ ok, runId, checks, usage: { cold, again, next }, stateTokens, deltaTokens, realStates: real }, null, 2))
  console.log(`\n${ok ? 'Smoke check passed' : 'Smoke check FAILED'}: ${join(outDir, 'smoke.json')}`)
  await db.$disconnect()
  return ok
}

main().then((ok) => process.exit(ok ? 0 : 1), (e) => {
  // A refused layout is the finding this check exists for: say it plainly.
  console.error(e instanceof Anthropic.BadRequestError ? `The API refused the layout: ${e.message}` : e instanceof Error ? e.message : e)
  process.exit(2)
})
