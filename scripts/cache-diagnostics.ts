/**
 * What Anthropic's cache diagnostics said about Mouse's interactive chat
 * (MOUSE_CACHE_DIAGNOSTICS, lib/mouse/cache-diagnostics.ts). Read-only.
 *
 *   npx tsx scripts/cache-diagnostics.ts [hours=24]
 *
 * Each request was compared with the previous response in its own chain
 * (same thread, source, model, lane and effort). The report splits each
 * run's first request (compared with the previous turn) from the rest
 * (compared within the run), counts each reason with what those requests
 * cost and the cache writes among them, and for each compared first request
 * names the prefix blocks that differ from the run that produced exactly the
 * response it was compared with. Read-lane attempts are runs of their own.
 */
import { db } from '@/lib/db'
import { costOf } from './cost-quality-audit'
import { prefixAttribution, runsOf, type SavedUsage } from '@/lib/mouse/cache-diagnostics'
import type { RequestUsage } from '@/lib/mouse/runner'

async function main() {
  const hours = Number(process.argv[2]) || 24
  const rows = await db.chatMessage.findMany({
    where: { role: 'ASSISTANT', createdAt: { gte: new Date(Date.now() - hours * 3600_000) } },
    orderBy: { createdAt: 'asc' },
    select: { agentUsageJson: true },
  })
  type Tally = { n: number; cost: number; writes: number; missed: number }
  const tally = { first: new Map<string, Tally>(), later: new Map<string, Tally>() }
  const add = (m: Map<string, Tally>, k: string, r: RequestUsage) => {
    const t = m.get(k) ?? { n: 0, cost: 0, writes: 0, missed: 0 }
    t.n++; t.cost += costOf(r) ?? 0; t.writes += r.cacheWriteTokens; t.missed += r.cacheDiagnosis?.missedTokens ?? 0
    m.set(k, t)
  }

  const runs = rows.flatMap((row) => runsOf(row.agentUsageJson as SavedUsage))
    .map((r) => ({ requests: (r.requests ?? []) as RequestUsage[], prefix: r.prefix }))
    .filter((r) => r.requests.some((q) => q.cacheDiagnosis))
  for (const r of runs) r.requests.forEach((q, i) => add(i === 0 ? tally.first : tally.later, q.cacheDiagnosis?.result ?? '(not recorded)', q))

  const moved = new Map<string, number>()
  for (const a of prefixAttribution(runs)) {
    const label = `${a.result}: ${a.moved === 'unlinked' ? 'previous response not in this window' : a.moved.length ? a.moved.join('+') : 'no prefix block moved'}`
    moved.set(label, (moved.get(label) ?? 0) + 1)
  }

  const show = (title: string, m: Map<string, Tally>) => {
    console.log(`\n${title}`)
    for (const [k, t] of [...m].sort((a, b) => b[1].cost - a[1].cost)) {
      console.log(`  ${k.padEnd(28)} ${String(t.n).padStart(4)} req  $${t.cost.toFixed(2).padStart(7)}  cache writes ${t.writes.toLocaleString().padStart(10)}  est. missed ${t.missed.toLocaleString()}`)
    }
  }
  console.log(`Chat runs with diagnostics in the last ${hours}h: ${runs.length}`)
  show('First request of a run (compared with the previous turn in its chain):', tally.first)
  show('Later requests (compared within the run):', tally.later)
  if (moved.size) {
    console.log('\nFirst requests: prefix blocks that differ from the exact response compared with')
    for (const [k, n] of [...moved].sort((a, b) => b[1] - a[1])) console.log(`  ${k}  (${n})`)
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
