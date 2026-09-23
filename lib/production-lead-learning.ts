import { db } from '@/lib/db'
import { observedLeadDays, type LeadTimeCandidate } from '@/lib/lead-time-core'
import { raiseLeadTimeQuestions } from '@/lib/lead-time-learning'

/**
 * The production-run half of lead-time learning — see
 * lib/lead-time-learning.ts for the purchase-order half and the reasoning
 * behind never writing the number itself, which applies here unchanged.
 *
 * ProductionRun.startedAt and .receivedAt existed in the schema and were
 * never set anywhere until 23 Sept 2026 — see update_production_run in
 * lib/mouse/tools.ts, which now sets startedAt the first time a run enters
 * IN_PRODUCTION and receivedAt the first time it reaches RECEIVED. A run
 * that skips straight past IN_PRODUCTION (a status jump from PLANNED
 * straight to READY_FOR_PICKUP, say) never gets a startedAt and so is
 * simply not learned from — safer than guessing at when work began.
 */
export async function checkProductionLeadDrift(runId: string): Promise<string[]> {
  const run = await db.productionRun.findUnique({
    where: { id: runId },
    include: { product: true, vendor: true },
  })
  if (!run) return []

  const observedDays = observedLeadDays(run.startedAt, null, run.receivedAt)
  if (observedDays === null) return []

  const candidate: LeadTimeCandidate = {
    entityType: 'PRODUCT',
    entityId: run.product.id,
    name: run.product.name,
    recorded: run.product.productionLeadTimeDays,
  }

  const sourceLabel = run.cutRef
    ? `the ${run.product.name} run (${run.vendor?.name ?? 'maker'}, ref ${run.cutRef})`
    : `the ${run.product.name} run (${run.vendor?.name ?? 'maker'})`

  return raiseLeadTimeQuestions(
    [candidate], observedDays, sourceLabel, 'when work started', run.startedAt!, run.receivedAt!,
  )
}
