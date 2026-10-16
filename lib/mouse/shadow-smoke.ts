import Anthropic from '@anthropic-ai/sdk'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { runTransientSmoke, type SmokeResult } from '@/lib/mouse/transient-smoke'

/**
 * The transient-layout smoke check, run once in production as a background
 * shadow job with Mouse's own server-side Anthropic credential (Codex,
 * 16 Oct 2026: no API key is being added to any cloud environment).
 *
 * Trigger: the first interactive chat reply that completes on a production
 * deployment carrying this code. The chat route calls scheduleShadowSmoke
 * after the reply is saved; Next's after() runs the job once the response has
 * been sent (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * after.md), so the reply is neither changed nor delayed. Live-tail stays the
 * live answer path and MOUSE_TRANSIENT_STATE is never read to decide anything
 * here, nor set.
 *
 * Once, ever: the ShadowRun row keyed SHADOW_KEY is the lock. Claiming it is
 * an INSERT ... ON CONFLICT DO NOTHING, which exactly one caller across every
 * instance can win; the row is never deleted, so whatever the outcome (passed,
 * failed, stopped short, or the instance dying mid-run and leaving it RUNNING)
 * nothing runs it again. A failure is recorded on the row and not retried.
 *
 * after() lives within the route's maxDuration (300 s for chat), which the
 * chat turn has already used part of. So the job only claims the lock when
 * the turn left at least SHADOW_LATEST_START_MS of headroom, and stops itself
 * at SHADOW_DEADLINE_MS, recording why, before the platform can cut it off.
 * A late turn claims nothing; the next one tries.
 */
export const SHADOW_KEY = 'transient-shadow-smoke'
/** The ModelUsage source its three requests are recorded under. */
export const SHADOW_SOURCE = 'transient-shadow-smoke'
/** Claim only if the chat turn finished within this long of the request arriving. */
export const SHADOW_LATEST_START_MS = 120_000
/** The run stops itself after this long: 120 + 150 s leaves 30 s of the route's 300 for the result write. */
export const SHADOW_DEADLINE_MS = 150_000

export type ShadowOutcome = 'not-production' | 'settled' | 'late' | 'lost-race' | 'unavailable' | 'passed' | 'failed' | 'error'

export type ShadowStore = {
  /** Is there a row for the key already, in any state? */
  exists(): Promise<boolean>
  /** Insert the RUNNING row; true only for the one caller whose insert landed. */
  claim(row: { codeVersion: string | null; deploymentId: string | null }): Promise<boolean>
  finish(f: { status: 'PASSED' | 'FAILED' | 'ERROR'; result: SmokeResult | null; error: string | null }): Promise<void>
}

export type ShadowEnv = { vercelEnv?: string; commit?: string; deploymentId?: string }

const prismaStore: ShadowStore = {
  async exists() {
    return (await db.shadowRun.findUnique({ where: { key: SHADOW_KEY }, select: { key: true } })) !== null
  },
  async claim(row) {
    const r = await db.shadowRun.createMany({ data: [{ key: SHADOW_KEY, status: 'RUNNING', ...row }], skipDuplicates: true })
    return r.count === 1
  },
  async finish(f) {
    await db.shadowRun.update({
      where: { key: SHADOW_KEY },
      data: { status: f.status, finishedAt: new Date(), resultJson: (f.result ?? undefined) as never, error: f.error },
    })
  },
}

const processEnv = (): ShadowEnv => ({ vercelEnv: process.env.VERCEL_ENV, commit: process.env.VERCEL_GIT_COMMIT_SHA, deploymentId: process.env.VERCEL_DEPLOYMENT_ID })

// Per instance: once this instance has seen or taken the lock, it never asks
// the database again. The row, not this flag, is what stops a second run.
let settled = false
export const resetShadowForTests = () => { settled = false }

export async function shadowSmokeOnce(o: {
  requestStartedAt: number
  now?: () => number
  env?: ShadowEnv
  store?: ShadowStore
  run?: (signal: AbortSignal, codeVersion: string | null) => Promise<SmokeResult>
}): Promise<ShadowOutcome> {
  const env = o.env ?? processEnv()
  const store = o.store ?? prismaStore
  const now = o.now ?? Date.now
  if (settled) return 'settled'
  if (env.vercelEnv !== 'production') return 'not-production'
  if (now() - o.requestStartedAt > SHADOW_LATEST_START_MS) return 'late'
  const codeVersion = env.commit ?? null
  try {
    if (await store.exists()) { settled = true; return 'settled' }
    if (!(await store.claim({ codeVersion, deploymentId: env.deploymentId ?? null }))) { settled = true; return 'lost-race' }
  } catch (e) {
    // No table (migration not applied) or no database: fail closed, quietly,
    // for the life of this instance. Nothing was claimed, nothing was spent.
    settled = true
    console.error('[shadow-smoke] lock unavailable; not running', e)
    return 'unavailable'
  }
  settled = true
  const run = o.run ?? ((signal, version) => runTransientSmoke({
    // Mouse's own credential, as every other Mouse request uses it. No retries:
    // a failure is recorded, never repeated.
    client: new Anthropic({ maxRetries: 0 }),
    source: SHADOW_SOURCE,
    codeVersion: version,
    signal,
    log: (l) => console.log(`[shadow-smoke] ${l}`),
  }))
  let status: 'PASSED' | 'FAILED' | 'ERROR' = 'ERROR'
  let result: SmokeResult | null = null
  let error: string | null = null
  try {
    result = await run(AbortSignal.timeout(SHADOW_DEADLINE_MS), codeVersion)
    status = result.error ? 'ERROR' : result.ok ? 'PASSED' : 'FAILED'
    error = result.error ? `${result.error.kind}: ${result.error.message}` : null
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  try {
    await store.finish({ status, result, error })
  } catch (e) {
    // The row stays RUNNING, which still never runs again; the usage rows and
    // this log line are what is left of the result.
    console.error('[shadow-smoke] could not record the result', { status, error, result }, e)
  }
  return status === 'PASSED' ? 'passed' : status === 'FAILED' ? 'failed' : 'error'
}

/**
 * Called by the chat route once a reply has completed and been saved. Off
 * production, or once this instance has settled, it schedules nothing at all.
 */
export function scheduleShadowSmoke(requestStartedAt: number) {
  if (settled || process.env.VERCEL_ENV !== 'production') return
  after(async () => {
    try {
      const outcome = await shadowSmokeOnce({ requestStartedAt })
      if (outcome !== 'settled') console.log(`[shadow-smoke] ${outcome}`)
    } catch (e) {
      console.error('[shadow-smoke] unexpected', e)
    }
  })
}
