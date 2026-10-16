/**
 * Smoke check on the real API (Codex review, 16 Oct
 * 2026): does Anthropic accept the transient layout's exact four-mark shape,
 * a one-hour mark on the history included, with the state after the last
 * mark, and does the cache behave as the layout assumes? A fake server
 * cannot answer that.
 *
 *   npx tsx scripts/transient-smoke.ts <outDir>
 *
 * SPENDS A LITTLE (about $0.20: three short Opus requests over the real rules
 * and core, and free token counts; never more than SMOKE_CEILING_USD, each
 * request checked at its worst case before it is sent). Needs
 * ANTHROPIC_API_KEY; refuses without it. Changes nothing. Writes
 * <outDir>/smoke.json.
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
 * 8,000-token target, the smoke check fails: the layout would miss the size
 * gate whatever the cache does.
 */
// This container sets ANTHROPIC_BASE_URL for its own use; the SDK would send
// these requests there. Pinned to Anthropic's public API, unless a dry run
// points MOUSE_API_BASE_URL at a local fake.
process.env.ANTHROPIC_BASE_URL = process.env.MOUSE_API_BASE_URL ?? 'https://api.anthropic.com'
import Anthropic from '@anthropic-ai/sdk'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { runTransientSmoke } from '@/lib/mouse/transient-smoke'

// The check itself is lib/mouse/transient-smoke.ts, shared with the one-time
// production shadow run (lib/mouse/shadow-smoke.ts), so both send the same
// three requests under the same ceiling.
const SOURCE = 'transient-smoke'

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set: this smoke check calls the API. Nothing was run.')
  const outDir = process.argv[2]
  if (!outDir) throw new Error('give an output folder: npx tsx scripts/transient-smoke.ts <outDir>')
  mkdirSync(outDir, { recursive: true })
  let codeVersion: string | null = null
  try { codeVersion = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim() } catch { /* not a checkout */ }
  const res = await runTransientSmoke({ client: new Anthropic({ maxRetries: 2 }), source: SOURCE, codeVersion, log: (l) => console.log(l) })
  writeFileSync(join(outDir, 'smoke.json'), JSON.stringify(res, null, 2))
  console.log(`\n${res.ok ? 'Smoke check passed' : 'Smoke check FAILED'}: ${join(outDir, 'smoke.json')}`)
  await db.$disconnect()
  return res.error ? 2 : res.ok ? 0 : 1
}

main().then((code) => process.exit(code), (e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(2)
})
