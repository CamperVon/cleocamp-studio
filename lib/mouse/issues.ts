import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { isOutOfCredit, OUT_OF_CREDIT_LOG } from '@/lib/mouse/credit-text'

/**
 * Mouse's troubleshooting log (MouseIssue). Written by code after each run,
 * never by the model deciding to: a failure Mouse glosses over in its reply
 * is still on record. See CLAUDE.md, "check the troubleshooting log".
 */

export type IssueDraft = { kind: 'TOOL_FAILED' | 'TURN_UNFINISHED' | 'NOTED'; tool?: string | null; detail: string; input?: unknown }

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** What one run's tool calls and ending say went wrong. Pure. */
export function issuesFrom(run: {
  toolCalls: Array<{ name: string; status: string; input?: unknown; result?: unknown; error?: string }>
  stopReason: string
  providerError?: string | null
}): IssueDraft[] {
  const out: IssueDraft[] = run.toolCalls
    .filter((c) => c.status === 'failed')
    .map((c) => ({ kind: 'TOOL_FAILED' as const, tool: c.name, detail: short(failureText(c), 600), input: c.input }))
  if (run.stopReason === 'provider_error' && isOutOfCredit(run.providerError)) out.push({ kind: 'TURN_UNFINISHED', detail: OUT_OF_CREDIT_LOG })
  else if (run.stopReason !== 'complete') out.push({ kind: 'TURN_UNFINISHED', detail: `The run stopped before finishing (${run.stopReason}).` })
  return out
}

/** The words of a failure: the thrown error, else the refusal Mouse was handed. Pure. */
export function failureText(c: { result?: unknown; error?: string }): string {
  if (c.error) return c.error
  const r = (c.result ?? {}) as Record<string, unknown>
  const said = r.error ?? r.reason ?? r.say ?? r.message
  return typeof said === 'string' && said.trim() ? said.trim() : short(JSON.stringify(c.result ?? null), 400)
}

/**
 * What a repeat changes on the row it joins. The question, door and input are
 * the LATEST occurrence's, not the first's: on 25 Nov 2026 a budget stop on
 * "actually i found it, order #3100" showed up in the log under a Torino
 * leather message from 15 Oct, because only the count moved, and the check
 * went looking at the wrong conversation. Pure.
 */
export function repeatUpdate(source: string, asked: string | null, d: IssueDraft, now: Date) {
  return {
    times: { increment: 1 },
    lastSeenAt: now,
    source,
    ...(asked ? { asked: short(asked, 500) } : {}),
    ...(d.input === undefined ? {} : { input: JSON.parse(JSON.stringify(d.input)) as Prisma.InputJsonValue }),
  }
}

/**
 * Write them. The same tool and the same words still open are one row with a
 * count, so a retry loop is one line in the log, not forty. The row shows the
 * most recent occurrence (repeatUpdate). Best-effort: a log that cannot be
 * written must never cost the person their reply.
 */
export async function logIssues(source: string, asked: string | null, drafts: IssueDraft[]): Promise<void> {
  for (const d of drafts) {
    try {
      const same = await db.mouseIssue.findFirst({
        where: { fixedAt: null, kind: d.kind, tool: d.tool ?? null, detail: d.detail },
        select: { id: true },
      })
      if (same) {
        await db.mouseIssue.update({ where: { id: same.id }, data: repeatUpdate(source, asked, d, new Date()) })
      } else {
        await db.mouseIssue.create({
          data: {
            kind: d.kind, source, tool: d.tool ?? null, detail: d.detail,
            input: d.input === undefined ? Prisma.DbNull : (JSON.parse(JSON.stringify(d.input)) as Prisma.InputJsonValue),
            asked: asked ? short(asked, 500) : null,
          },
        })
      }
    } catch (e) {
      console.error('[mouse-issues] could not log', e)
    }
  }
}
