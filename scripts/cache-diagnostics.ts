/**
 * What Anthropic's cache diagnostics said about Mouse's chat turns
 * (MOUSE_CACHE_DIAGNOSTICS, lib/mouse/cache-diagnostics.ts). Read-only.
 *
 *   npx tsx scripts/cache-diagnostics.ts [hours=24]
 *
 * Splits each turn's first request (compared with the previous turn) from the
 * rest (compared within the turn), counts each reason with what those
 * requests cost and the cache writes among them, and for a system_changed
 * first request names which prefix blocks changed since the previous turn.
 */
import { db } from '@/lib/db'
import { costOf } from './cost-quality-audit'
import type { AgentUsage, RequestUsage } from '@/lib/mouse/runner'

async function main() {
  const hours = Number(process.argv[2]) || 24
  const rows = await db.chatMessage.findMany({
    where: { role: 'ASSISTANT', createdAt: { gte: new Date(Date.now() - hours * 3600_000) } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, agentUsageJson: true },
  })
  type Tally = { n: number; cost: number; writes: number; missed: number }
  const tally = { first: new Map<string, Tally>(), later: new Map<string, Tally>() }
  const add = (m: Map<string, Tally>, k: string, r: RequestUsage) => {
    const t = m.get(k) ?? { n: 0, cost: 0, writes: 0, missed: 0 }
    t.n++; t.cost += costOf(r) ?? 0; t.writes += r.cacheWriteTokens; t.missed += r.cacheDiagnosis?.missedTokens ?? 0
    m.set(k, t)
  }
  const blocksMoved = new Map<string, number>()
  const lastPrefix = new Map<string, AgentUsage['prefix']>()
  let turns = 0

  for (const row of rows) {
    const u = row.agentUsageJson as AgentUsage | null
    if (!u) continue
    const runs: Array<{ reqs: RequestUsage[]; prefix?: AgentUsage['prefix'] }> = [
      ...(u.route?.attempt ? [{ reqs: u.route.attempt.requests }] : []),
      { reqs: u.requests ?? [], prefix: u.prefix },
    ]
    for (const { reqs, prefix } of runs) {
      if (!reqs.some((r) => r.cacheDiagnosis)) continue
      turns++
      reqs.forEach((r, i) => add(i === 0 ? tally.first : tally.later, r.cacheDiagnosis?.result ?? '(not recorded)', r))
      const head = reqs[0]
      const key = `${head.model}|${head.lane ?? 'full'}`
      const before = lastPrefix.get(key)
      if (prefix && before && head.cacheDiagnosis?.result === 'system_changed') {
        const moved = (Object.keys(prefix) as Array<keyof typeof prefix>).filter((k) => prefix[k] !== before[k])
        const label = moved.length ? moved.join('+') : '(no block hash moved)'
        blocksMoved.set(label, (blocksMoved.get(label) ?? 0) + 1)
      }
      if (prefix) lastPrefix.set(key, prefix)
    }
  }

  const show = (title: string, m: Map<string, Tally>) => {
    console.log(`\n${title}`)
    for (const [k, t] of [...m].sort((a, b) => b[1].cost - a[1].cost)) {
      console.log(`  ${k.padEnd(28)} ${String(t.n).padStart(4)} req  $${t.cost.toFixed(2).padStart(7)}  cache writes ${t.writes.toLocaleString().padStart(10)}  est. missed ${t.missed.toLocaleString()}`)
    }
  }
  console.log(`Chat runs with diagnostics in the last ${hours}h: ${turns}`)
  show('First request of a run (compared with the previous run on the same model and lane):', tally.first)
  show('Later requests (compared within the run):', tally.later)
  if (blocksMoved.size) {
    console.log('\nsystem_changed on a first request: which prefix blocks moved since the previous run')
    for (const [k, n] of blocksMoved) console.log(`  ${k}: ${n}`)
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
