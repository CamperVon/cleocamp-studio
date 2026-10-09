import { LOOK_UP_KIND } from '@/lib/mouse/tool-kinds'

export type ToolOutcome = {
  name: string
  input: unknown
  status: 'succeeded' | 'failed' | 'no_change'
  result?: unknown
  error?: string
  durationMs: number
  isWrite: boolean
  /** Characters of the result as Mouse was given it: the size only (scripts/cost-quality-audit.ts). */
  resultChars?: number
}

/**
 * What is kept of a tool's result with the turn. An email's own text is not:
 * for the email search and open_email only the ids and sizes are kept, which
 * is all the cost audit needs (9 Oct 2026). Everything else as before. Pure.
 */
export function storedResult(name: string, input: unknown, result: unknown): unknown {
  const r = result && typeof result === 'object' ? result as Record<string, unknown> : null
  if (name === 'query_status' && (input as { what?: unknown } | null)?.what === 'email' && r && Array.isArray(r.emails)) {
    return { emailIds: (r.emails as Array<{ id?: unknown }>).map((e) => e.id), shown: r.shown, textNotKept: true }
  }
  if (name === 'open_email' && r) {
    return r.found ? { found: true, id: r.id, bodyChars: r.bodyChars, textNotKept: true } : { found: false, reason: r.reason }
  }
  return diagnosticValue(result)
}

/** The size of what a tool handed the model: text in characters, a file by its encoded length. Pure. */
export function resultChars(content: string | Array<{ type: string; text?: string; source?: { data?: string } }>): number {
  if (typeof content === 'string') return content.length
  return content.reduce((n, b) => n + (b.text?.length ?? b.source?.data?.length ?? 0), 0)
}

// Look-ups: a call to one is never a write, so it cannot count as having
// recorded something (see owedTheRecordSomething).
// Every look-up in lib/mouse/tool-kinds.ts, so a new one is never counted as
// a write by being missed here.
const READ_TOOLS = new Set([
  ...LOOK_UP_KIND,
  // A line in the troubleshooting log is not a record of the business: it
  // must not satisfy "you said it was noted, so write something down".
  'note_problem',
])

export function classifyResult(name: string, result: unknown): Pick<ToolOutcome, 'status' | 'isWrite'> {
  const r = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  if (r.error || r.ok === false || r.applied === false) return { status: 'failed', isWrite: false }
  // A draft is the first step of every send (email, invoice, gift): shown,
  // not sent, on purpose. It was being reported back to Mouse as an error.
  if (r.draft === true) return { status: 'no_change', isWrite: false }
  if (r.sent === false) return { status: 'failed', isWrite: false }
  if (r.created === false || r.skipped) return { status: 'no_change', isWrite: false }
  return { status: 'succeeded', isWrite: !READ_TOOLS.has(name) }
}

/** Defensive redaction for persisted diagnostics; no provider secrets or binary files. */
export function diagnosticValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  // Dates and Prisma Decimals are objects with a toJSON. Walking their own
  // keys instead turned a date into {} and a Decimal into {s, e, d,
  // constructor: [Function]} — and Prisma refuses a function inside a JSON
  // column, so saving the chat turn threw and the whole answer was lost.
  // That is what "Something went wrong reaching me" was on 24 Sept 2026,
  // every time Mouse looked up inventory events (their quantities are
  // Decimals). Use the value's own JSON form, and drop functions outright.
  if (typeof value === 'function') return undefined
  if (value && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return diagnosticValue((value as { toJSON: () => unknown }).toJSON())
  }
  if (typeof value === 'string') return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL removed]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [removed]')
    .replace(/(?:sk-ant-|sk-proj-|npg_|shpat_)[a-zA-Z0-9_-]+/g, '[credential removed]')
    .slice(0, 8000)
  if (Array.isArray(value)) return value.slice(0, 100).map(diagnosticValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [
      key,
      /password|secret|token|base64|^pdf$|authorization|api.?key/i.test(key) ? '[removed]' : diagnosticValue(val),
    ]))
  }
  return value
}

export function completedWrites(calls: unknown): Array<{ tool: string; summary: string }> {
  if (!Array.isArray(calls)) return []
  // Historical entries contain only input, so cannot establish success.
  return calls.filter((c): c is ToolOutcome => c?.status === 'succeeded' && c?.isWrite === true)
    .map(c => ({ tool: c.name, summary: JSON.stringify(c.result ?? {}) }))
}
