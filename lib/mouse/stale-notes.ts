import { db } from '@/lib/db'

/**
 * After Mouse changes something, the notes on that same thing come back with
 * the result, so a note the change has just made wrong is in front of it while
 * it can still retire it.
 *
 * 24 Sept 2026, twice in one afternoon. Jane's Story Dress count was applied
 * to Shopify on Brandon's say-so, and the note beside it went on saying
 * "flagged, not applied — do not correct any inventory event off this count".
 * The next reader believed the note over the ledger and reported a
 * discrepancy that did not exist. The same day a hangtag note said "do not
 * report them as needing a count" long after that stopped being true. In both
 * cases the record moved and nothing asked about the note.
 *
 * add_note and retire_note already deal with notes themselves, and a read has
 * changed nothing, so neither gets this.
 */
const SKIP = new Set(['add_note', 'retire_note', 'query_status', 'check_sent_mail', 'open_record'])

/** Input keys that name the thing a tool changed — what a note's entityId points at. */
const SUBJECT_KEYS = ['id', 'productId', 'forProductId', 'componentId', 'vendorId', 'atVendorId', 'productVariantId', 'poNumber', 'runId', 'productionRunId']

/** The ids a tool call was about, from its input. Pure, so it can be tested. */
export function subjectIds(input: unknown): string[] {
  if (!input || typeof input !== 'object') return []
  const i = input as Record<string, unknown>
  const ids = SUBJECT_KEYS.map((k) => i[k])
    .filter((v): v is string | number => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number')
    .map((v) => String(v).trim())
  return [...new Set(ids)]
}

/**
 * Each note whole, newest first, up to a size limit; the rest by id. These
 * were cut to 200 characters each and capped at ten, which was harmless
 * while every note was also in full in the catalogue. Chat's catalogue now
 * lists notes by subject (lib/mouse/notes.ts), so this is where a correction
 * on the thing just changed would be read: never cut one mid-way (6 Oct 2026).
 * Pure.
 */
export function boundNotes(notes: Array<{ id: string; content: string }>, budget = 6_000): { shown: { id: string; text: string }[]; more: string[] } {
  const shown: { id: string; text: string }[] = []
  const more: string[] = []
  let used = 0
  for (const n of notes) {
    if (used + n.content.length > budget && shown.length) { more.push(n.id); continue }
    shown.push({ id: n.id, text: n.content })
    used += n.content.length
  }
  return { shown, more }
}

export async function notesOnWhatChanged(name: string, input: unknown): Promise<{ shown: { id: string; text: string }[]; more: string[] }> {
  const none = { shown: [], more: [] }
  if (SKIP.has(name)) return none
  const ids = subjectIds(input)
  if (!ids.length) return none
  // A variant's notes are usually written against its product.
  const variants = await db.productVariant.findMany({ where: { id: { in: ids } }, select: { productId: true } })
  const all = [...new Set([...ids, ...variants.map((v) => v.productId)])]
  const notes = await db.note.findMany({
    where: { entityId: { in: all }, supersededAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, content: true },
  })
  return boundNotes(notes)
}

/** Hang the notes on a successful write's result, with the question to ask of them. */
export async function withNotesOnWhatChanged(name: string, input: unknown, result: unknown): Promise<unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const r = result as Record<string, unknown>
  if (r.error || r.ok === false || r.applied === false || r.sent === false || r.skipped) return result
  const { shown, more } = await notesOnWhatChanged(name, input).catch(() => ({ shown: [], more: [] as string[] }))
  if (!shown.length) return result
  return {
    ...r,
    notesOnWhatYouJustChanged: shown,
    ...(more.length ? { moreNotesOnIt: `${more.length} more current note(s) on this, not shown here for length: ${more.join(', ')}. Read them with open_record before relying on what you just changed.` } : {}),
    noteCheck: 'Read these against the change you just made. Any that now says something untrue, or tells the next reader to do something that no longer applies, retire now with retire_note, or replace it with add_note and supersedes.',
  }
}
