export type ToolOutcome = {
  name: string
  input: unknown
  status: 'succeeded' | 'failed' | 'no_change'
  result?: unknown
  error?: string
  durationMs: number
  isWrite: boolean
}

const READ_TOOLS = new Set(['query_status', 'request_deep_analysis'])

export function classifyResult(name: string, result: unknown): Pick<ToolOutcome, 'status' | 'isWrite'> {
  const r = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  if (r.error || r.ok === false || r.sent === false || r.applied === false) return { status: 'failed', isWrite: false }
  if (r.created === false || r.skipped) return { status: 'no_change', isWrite: false }
  return { status: 'succeeded', isWrite: !READ_TOOLS.has(name) }
}

/** Defensive redaction for persisted diagnostics; no provider secrets or binary files. */
export function diagnosticValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
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
