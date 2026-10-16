/**
 * The shadow bake-off's stored result, printed for review. Read-only: it
 * reads the ShadowRun row keyed transient-shadow-bakeoff and the usage rows
 * recorded under the same source, and changes nothing.
 *
 *   npx tsx scripts/shadow-bakeoff-report.ts          the report
 *   npx tsx scripts/shadow-bakeoff-report.ts --json   the whole row as JSON
 */
import { db } from '@/lib/db'
import { BAKEOFF_KEY, BAKEOFF_SOURCE, type Report } from '@/lib/mouse/shadow-bakeoff-judge'

const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(4)}`)

async function main() {
  const row = await db.shadowRun.findUnique({ where: { key: BAKEOFF_KEY } })
  if (!row) { console.log('No bake-off has run.'); return }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(row, null, 2)); return }
  const usage = await db.modelUsage.aggregate({ where: { source: BAKEOFF_SOURCE }, _count: true })
  const rep = (row.resultJson as { report?: Report } | null)?.report
  console.log(`Status ${row.status} · started ${row.startedAt.toISOString()} · finished ${row.finishedAt?.toISOString() ?? '—'}${row.error ? `\nError: ${row.error}` : ''}`)
  console.log(`Usage rows under ${BAKEOFF_SOURCE}: ${usage._count}`)
  if (!rep) return
  console.log(`Spent ${usd(rep.spentUsd)} of $${rep.capUsd} · code ${rep.codeVersions.join(', ')}\n${rep.quality}\n`)
  for (const [l, t] of Object.entries(rep.totals)) {
    console.log(`${l.padEnd(9)} ${t.completed}/${t.turns} turns complete · ${t.requests} requests · ${usd(t.costUsd)} (${usd(t.costPerCompletedTurn)}/completed turn; first requests ${usd(t.firstRequestCost)}, follow-ons ${usd(t.laterRequestsCost)})`)
    console.log(`          latency median ${(t.latencyMs.median / 1000).toFixed(1)} s, max ${(t.latencyMs.max / 1000).toFixed(1)} s · cache write ${t.cacheWrite} (1h ${t.cacheWrite1h}, 5m ${t.cacheWrite5m}) · read ${t.cacheRead} · uncached in ${t.uncachedInput} · out ${t.output}`)
    console.log(`          tool calls ${t.toolCalls} · look-ups ${t.lookUps} · stopped writes ${t.stoppedWrites}${t.stateTokens ? ` · state tokens median ${t.stateTokens.median}, max ${t.stateTokens.max}` : ''}`)
  }
  const r = rep.transientVsLiveTail
  console.log(`\ntransient ÷ live-tail: cost per completed turn ${r.costPerCompletedTurn?.toFixed(3) ?? '—'} · latency median ${r.latencyMedian?.toFixed(3) ?? '—'} · cache writes ${r.cacheWrite?.toFixed(3) ?? '—'}`)
  for (const p of rep.pairs) {
    console.log(`\n── ${p.scenario} (${p.kind})`)
    p.question.forEach((q, i) => {
      console.log(`  Q${i + 1}: ${q}`)
      for (const [l, rs] of Object.entries(p.replies)) {
        const x = rs[i]
        if (!x) { console.log(`   ${l}: (no turn)`); continue }
        console.log(`   ${l} · ${x.stopReason} · ${usd(x.costUsd)} · ${(x.wallMs / 1000).toFixed(1)} s · ${x.requests} req · tools: ${x.tools.join(', ') || 'none'}${x.check ? ` · ${x.check}` : ''}`)
        console.log(`     ${x.text.replace(/\s+/g, ' ')}`)
      }
    })
  }
  if (rep.failure) console.log(`\nFAILED: ${rep.failure}`)
  console.log(`\nNext: ${rep.nextStep}`)
}

main().then(() => db.$disconnect(), async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
