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
const SKIP = new Set(['add_note', 'retire_note', 'query_status', 'check_sent_mail', 'request_deep_analysis'])

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

export async function notesOnWhatChanged(name: string, input: unknown): Promise<{ id: string; text: string }[]> {
  if (SKIP.has(name)) return []
  const ids = subjectIds(input)
  if (!ids.length) return []
  // A variant's notes are usually written against its product.
  const variants = await db.productVariant.findMany({ where: { id: { in: ids } }, select: { productId: true } })
  const all = [...new Set([...ids, ...variants.map((v) => v.productId)])]
  const notes = await db.note.findMany({
    where: { entityId: { in: all }, supersededAt: null },
    orderBy: { createdAt: 'desc' }, take: 10,
    select: { id: true, content: true },
  })
  return notes.map((n) => ({ id: n.id, text: n.content.slice(0, 200) }))
}

/** Hang the notes on a successful write's result, with the question to ask of them. */
export async function withNotesOnWhatChanged(name: string, input: unknown, result: unknown): Promise<unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const r = result as Record<string, unknown>
  if (r.error || r.ok === false || r.applied === false || r.sent === false || r.skipped) return result
  const notes = await notesOnWhatChanged(name, input).catch(() => [])
  if (!notes.length) return result
  return {
    ...r,
    notesOnWhatYouJustChanged: notes,
    noteCheck: 'Read these against the change you just made. Any that now says something untrue, or tells the next reader to do something that no longer applies, retire now with retire_note, or replace it with add_note and supersedes.',
  }
}
