/**
 * Notes in Mouse's context, phase 2A of the cost plan (6 Oct 2026).
 *
 * The catalogue carried every current note in full on every chat turn: about
 * 15,000 tokens, most of it about records the turn had nothing to do with.
 * For chat it now carries an INDEX instead: one line per subject saying how
 * many current notes it has and when the newest was written. Notes with no
 * subject (standing observations, no record to look them up by) stay in
 * full. The full notes on any subject come back whole from open_record, and
 * when a message names a record exactly, code looks it up before Mouse
 * reads the message, so the notes are already there.
 *
 * Rules this keeps:
 *   - a note is shown whole or listed as retrievable; never cut mid-way
 *     (until 15 Sept 2026 truncation hid a live correction);
 *   - the WRITTEN BEFORE THE LATEST COUNT warning travels with the note;
 *   - nothing is preloaded on a guess: an exact PO number, a stored id, or a
 *     record's exact full name, and only when exactly one record answers;
 *     a name two records share is reported, not chosen between.
 *
 * Background runs (nightly mail, answer-item, in-flight) still get the full
 * notes section; renderNotesFull is that path, unchanged.
 */

export type NoteRow = { id: string; entityType: string; entityId: string | null; content: string; createdAt: Date }

/** A record notes can be about, as code knows it. `keys` are the exact strings that name it. */
export type RecordRef = { kind: RecordKind; id: string; name: string; keys: string[] }
export type RecordKind = 'product' | 'component' | 'vendor' | 'purchase order' | 'production run' | 'wholesale account' | 'note subject'

// A note that states a count goes stale the moment a newer count or delivery
// is logged for the same thing, and it reads just as confidently (25 Sept
// 2026: a 16 Sept note said 2,100 Main labels over the 4,010 in the ledger).
// Marked, not retired: telling a count note from a standing rule by its
// wording is guesswork, and guessing wrong would throw away what a person said.
export const COUNT_WORDS = /\b(count|counted|counts|on hand|in (the )?studio|physical(ly)?|in stock)\b/i

const laDay = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })

/** True when the note may hold a count that a later count has overtaken. Pure. */
export function isStale(n: Pick<NoteRow, 'entityId' | 'content' | 'createdAt'>, latestCount: Map<string, Date>): boolean {
  const overtaken = n.entityId ? latestCount.get(n.entityId) : undefined
  return !!overtaken && overtaken > n.createdAt && COUNT_WORDS.test(n.content)
}

/**
 * One note as Mouse reads it: its id (what add_note's supersedes and
 * retire_note take), its whole text, and the stale-count warning when it
 * applies. Exactly the line the catalogue has always printed. Pure.
 */
export function noteLine(n: NoteRow, latestCount: Map<string, Date>): string {
  const overtaken = n.entityId ? latestCount.get(n.entityId) : undefined
  const stale = isStale(n, latestCount)
    ? ` (WRITTEN BEFORE THE LATEST COUNT, ${laDay(overtaken!)}: if this note says how many there are, that number is out of date — use the on-hand figure above)`
    : ''
  return `[${n.id}] ${n.content.replace(/\s+/g, ' ')}${stale}`
}

/** "Cleo Tee [prd_cleo_tee]", or the type and raw id when code does not know the record. Pure. */
export function subjectLabel(n: Pick<NoteRow, 'entityType' | 'entityId'>, nameOf: Map<string, string>): string {
  return n.entityId
    ? `${nameOf.get(n.entityId) ?? n.entityType.toLowerCase().replace(/_/g, ' ')} [${n.entityId}]`
    : 'General'
}

const HEADER = [
  '\n## Notes you have written',
  'Everything under this heading is CURRENT. Retired notes are not shown;',
  'to look one up on purpose ("what did we used to pay?"), use query_status',
  'with what "retiredNotes" — and never quote one as though it still held.',
  'Each note starts with its id in brackets: the id add_note\'s `supersedes`',
  'and retire_note take.',
]

type SectionInput = {
  notes: NoteRow[]
  /** Keys of open orders: a note on any other order is history. */
  openPoKeys: Set<string>
  nameOf: Map<string, string>
  latestCount: Map<string, Date>
}

function closedPoSplit(i: SectionInput) {
  const onClosedPo = i.notes.filter((n) => n.entityType === 'PURCHASE_ORDER' && n.entityId && !i.openPoKeys.has(n.entityId))
  return { onClosedPo, live: i.notes.filter((n) => !onClosedPo.includes(n)) }
}

/**
 * The notes section exactly as it was before phase 2A: every current note in
 * full, grouped by subject, newest first within the character budget. Kept
 * for background runs and as the reference the index is tested against. Pure.
 */
export function renderNotesFull(i: SectionInput): string[] {
  if (!i.notes.length) return []
  const BUDGET = 60_000
  const { onClosedPo, live } = closedPoSplit(i)
  const shown: NoteRow[] = []
  let used = 0
  for (const n of live) {
    used += n.content.length
    if (used > BUDGET && shown.length) break
    shown.push(n)
  }
  const dropped = live.length - shown.length
  const groups = new Map<string, string[]>()
  for (const n of shown) {
    const subject = subjectLabel(n, i.nameOf)
    const list = groups.get(subject) ?? []
    list.push(noteLine(n, i.latestCount))
    groups.set(subject, list)
  }
  const L = [...HEADER]
  if (onClosedPo.length) L.push(`(${onClosedPo.length} note${onClosedPo.length === 1 ? '' : 's'} on received or cancelled orders not shown — query_status with what "notes" and the order's id or number.)`)
  if (dropped > 0) L.push(`(${dropped} older note${dropped === 1 ? '' : 's'} not shown — say so if asked rather than implying you have seen everything.)`)
  const keys = [...groups.keys()].sort((a, b) => (a === 'General' ? 1 : b === 'General' ? -1 : a.localeCompare(b)))
  for (const k of keys) {
    L.push(`\n### ${k}`)
    for (const c of groups.get(k)!) L.push(`- ${c}`)
  }
  return L
}

/**
 * The notes section for chat: one line per subject, and the notes with no
 * subject in full. Every current note is either shown whole or counted under
 * a subject that open_record returns whole. Pure.
 */
export function renderNotesIndex(i: SectionInput): string[] {
  if (!i.notes.length) return []
  const { onClosedPo, live } = closedPoSplit(i)
  const bySubject = new Map<string, NoteRow[]>()
  const general: NoteRow[] = []
  for (const n of live) {
    if (!n.entityId) { general.push(n); continue }
    const list = bySubject.get(n.entityId) ?? []
    list.push(n)
    bySubject.set(n.entityId, list)
  }
  const L = [...HEADER]
  L.push('Notes on a record are listed by subject: how many are current and when the')
  L.push('newest was written. Their text is not here. Before you answer about a record')
  L.push('listed below, or change it, read its notes with open_record (give the id in')
  L.push('brackets). When a message names a record exactly, its notes may already be')
  L.push('with the message. Notes with no subject are shown in full under General.')
  if (onClosedPo.length) L.push(`(${onClosedPo.length} note${onClosedPo.length === 1 ? '' : 's'} on received or cancelled orders not listed — query_status with what "notes" and the order's id or number.)`)
  const rows = [...bySubject.entries()].map(([id, ns]) => {
    const label = subjectLabel(ns[0], i.nameOf)
    const newest = ns.reduce((d, n) => (n.createdAt > d ? n.createdAt : d), ns[0].createdAt)
    const stale = ns.filter((n) => isStale(n, i.latestCount)).length
    return { label, line: `- ${label}: ${ns.length} note${ns.length === 1 ? '' : 's'}, newest ${laDay(newest)}${stale ? ` · ${stale} written before the latest count` : ''}`, id }
  }).sort((a, b) => a.label.localeCompare(b.label))
  if (rows.length) {
    L.push('\n### Notes by subject (read with open_record)')
    for (const r of rows) L.push(r.line)
  }
  if (general.length) {
    L.push('\n### General')
    for (const n of general) L.push(`- ${noteLine(n, i.latestCount)}`)
  }
  return L
}

// ── Finding a record by an exact reference ─────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()

/** "PO 2391", "po #2391", "2391" → "2391"; anything else unchanged. Pure. */
export function poNumberOf(ref: string): string | null {
  const m = /^\s*(?:po\s*#?\s*)?(\d{4,5})\s*$/i.exec(ref)
  return m ? m[1] : null
}

/**
 * The record a reference names, by exact match only: a stored id, a PO
 * number, or a record's full name (case and spacing aside). More than one
 * record answering is ambiguous and nothing is chosen. Pure.
 */
export function resolveRecord(ref: string, directory: RecordRef[]):
  | { status: 'found'; record: RecordRef }
  | { status: 'ambiguous'; candidates: RecordRef[] }
  | { status: 'none' } {
  const want = norm(ref)
  if (!want) return { status: 'none' }
  const po = poNumberOf(ref)
  const hits = directory.filter((r) => r.keys.some((k) => norm(k) === want) || (po !== null && r.kind === 'purchase order' && r.keys.includes(po)))
  const unique = [...new Map(hits.map((r) => [`${r.kind}:${r.id}`, r])).values()]
  if (!unique.length) return { status: 'none' }
  return unique.length === 1 ? { status: 'found', record: unique[0] } : { status: 'ambiguous', candidates: unique }
}

/**
 * The records a message names exactly, for prefetch: "PO 1234", a stored id
 * as a whole word, or a record's full name as whole words (at least four
 * characters, so "Tee" alone names nothing). Where one exact name sits
 * inside a longer one ("Cleo Tee" in "Cleo Tee hangtag"), the longer wins.
 * A name two records share is returned as ambiguous and not looked up. Pure.
 */
export function mentionedRecords(message: string, directory: RecordRef[]): { found: RecordRef[]; ambiguous: Array<{ said: string; candidates: RecordRef[] }> } {
  const text = message
  const lower = text.toLowerCase()
  type Hit = { start: number; end: number; said: string; records: RecordRef[] }
  const hits: Hit[] = []

  for (const m of text.matchAll(/\bPO\s*#?\s*(\d{4,5})\b/gi)) {
    const recs = directory.filter((r) => r.kind === 'purchase order' && r.keys.includes(m[1]))
    if (recs.length) hits.push({ start: m.index!, end: m.index! + m[0].length, said: m[0], records: recs })
  }
  // Names and ids, grouped by the exact text that would match them.
  const byKey = new Map<string, RecordRef[]>()
  // A free-text note subject ("stylists") is reachable through open_record
  // only: an everyday word in a message must not preload anything.
  for (const r of directory.filter((x) => x.kind !== 'note subject')) {
    for (const k of [r.id, r.name]) {
      const key = norm(k)
      if (key.length < 4) continue
      const list = byKey.get(key) ?? []
      if (!list.some((x) => x.kind === r.kind && x.id === r.id)) list.push(r)
      byKey.set(key, list)
    }
  }
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  for (const [key, recs] of byKey) {
    const re = new RegExp(`(?<![\\w-])${escape(key)}(?![\\w-])`, 'g')
    for (const m of lower.matchAll(re)) hits.push({ start: m.index!, end: m.index! + m[0].length, said: text.slice(m.index!, m.index! + m[0].length), records: recs })
  }
  // Longest match wins where matches overlap.
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  const kept: Hit[] = []
  for (const h of hits) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h)
  kept.sort((a, b) => a.start - b.start)

  const found = new Map<string, RecordRef>()
  const ambiguous: Array<{ said: string; candidates: RecordRef[] }> = []
  for (const h of kept) {
    const uniq = [...new Map(h.records.map((r) => [`${r.kind}:${r.id}`, r])).values()]
    if (uniq.length === 1) found.set(`${uniq[0].kind}:${uniq[0].id}`, uniq[0])
    else if (!ambiguous.some((a) => norm(a.said) === norm(h.said))) ambiguous.push({ said: h.said, candidates: uniq })
  }
  return { found: [...found.values()], ambiguous }
}

/**
 * What goes with a message whose records were named exactly: each record's
 * notes in full, whole records only, within a character budget. A record
 * whose notes do not fit is listed as one to open, never cut. Records with
 * no current notes add nothing. Ambiguous names are said out loud. Pure.
 */
export function prefetchBlock(
  matches: { found: RecordRef[]; ambiguous: Array<{ said: string; candidates: RecordRef[] }> },
  notesFor: (r: RecordRef) => NoteRow[],
  latestCount: Map<string, Date>,
  budget = 8_000,
  maxRecords = 3,
): string | null {
  const parts: string[] = []
  const notShown: RecordRef[] = []
  let used = 0
  let shown = 0
  for (const r of matches.found) {
    const ns = notesFor(r)
    if (!ns.length) continue
    const lines = ns.map((n) => `- ${noteLine(n, latestCount)}`)
    const size = lines.reduce((s, l) => s + l.length + 1, 0)
    if (shown >= maxRecords || (used + size > budget && shown > 0)) { notShown.push(r); continue }
    parts.push(`### ${r.name} [${r.id}] (${r.kind}): ${ns.length} current note${ns.length === 1 ? '' : 's'}, in full`, ...lines)
    used += size
    shown++
  }
  const amb = matches.ambiguous.map((a) => `- "${a.said}" names more than one record, so none was looked up: ${a.candidates.map((c) => `${c.name} [${c.id}] (${c.kind})`).join('; ')}. Use open_record with the id you mean.`)
  const more = notShown.map((r) => `- ${r.name} [${r.id}] (${r.kind}) also has notes: read them with open_record before relying on them.`)
  if (!parts.length && !amb.length && !more.length) return null
  return [
    '[The app looked up the records this message names exactly. Current notes, in full; read-only. This is not from the person.]',
    ...parts,
    ...(more.length ? ['', ...more] : []),
    ...(amb.length ? ['', ...amb] : []),
  ].join('\n')
}
