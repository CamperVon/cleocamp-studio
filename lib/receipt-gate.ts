/**
 * Goods received: logged only when a person stated the number (16 Oct 2026).
 *
 * The shadow bake-off asked Mouse "PO 2360 arrived in full today." One run
 * asked what "in full" covered; the other logged the White tees as received
 * at the quantities the PO still owed, and closed a to-do, before anyone had
 * said a number. Practice mode stopped it. Whether Mouse asks first depended
 * on which context it happened to see, so code decides now:
 *
 * - A RECEIVED entry goes in at once only when its quantity is a number the
 *   person wrote, in this message or one of their last few. Numbers Mouse
 *   itself wrote (what the PO still owes, say) do not count. The same holds
 *   for a COUNTED number and an upward MANUAL_ADJUST, the other two ways
 *   stock is added, so the receipt cannot be put in by another door.
 * - Otherwise it is held (PendingReceipt), not logged. Code adds the held
 *   lines to the reply, so the person sees exactly what would go in.
 * - It is logged only from a LATER turn, by the same person, naming the held
 *   line, with the same item, place, quantity and PO. A held line is used once
 *   and lapses after two days.
 *
 * The turn (an id and the person's words) is set by runAgent for every run;
 * a tool called outside a run has no turn, and everything it receives is held.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '@/lib/db'

export type Turn = { id: string; personId: string | null; words: string[] }

const turnStore = new AsyncLocalStorage<Turn>()

export function inTurn<T>(turn: Turn, fn: () => Promise<T>): Promise<T> {
  return turnStore.run(turn, fn)
}

export function currentTurn(): Turn | null {
  return turnStore.getStore() ?? null
}

/** A held line lapses after this long. */
export const HOLD_MS = 2 * 24 * 60 * 60 * 1000

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b'
/** Numbers that name something rather than count it: sizes, dates, order and PO numbers. */
const NOT_A_COUNT = [
  // "sizes 1, 2 and 3": a comma continues the list only when another
  // separator follows, so "510 size 1, 245 size 2" keeps the 245.
  /\b(?:sizes?|sz)\s*\d{1,2}\b(?:\s*(?:and|&|or|\/)\s*\d{1,2}\b|\s*,\s*\d{1,2}(?=\s*(?:,|and\b|&|or\b|\/|:)))*/gi,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}`, 'gi'),
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'),
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /#\s*\d+/g,
  /\bPOs?\s*#?\s*\d+/gi,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi,
]

/**
 * Every number written in the text as a count: "1,033" and "1033" alike,
 * "6.25", "510". Sizes ("size 1"), dates ("14 Oct", "10/14"), times, order
 * and PO numbers are left out, so "PO 2360 size 1 arrived 14 Oct" states no
 * count at all. Pure.
 */
export function statedNumbers(texts: string[], poNumber?: string | null): Set<number> {
  const out = new Set<number>()
  for (const raw of texts) {
    const t = NOT_A_COUNT.reduce((s, re) => s.replace(re, ' '), raw)
    for (const m of t.matchAll(/(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])|(?<![\d.,])\d+(?:\.\d+)?(?![\d])/g)) {
      const n = Number(m[0].replace(/,/g, ''))
      if (Number.isFinite(n)) out.add(n)
    }
  }
  // "None left", "zero", "sold out": a count of 0 in words.
  if (texts.some((t) => /\b(?:none|zero|nothing left|no more left|sold out|out of stock)\b/i.test(t))) out.add(0)
  if (poNumber && /^\d+$/.test(poNumber)) out.delete(Number(poNumber))
  return out
}

/** The entry types that add stock, and so are held when nobody stated the number. */
export const HELD_TYPES = new Set(['RECEIVED', 'COUNTED', 'MANUAL_ADJUST'])

/** True when a receipt of this quantity must wait for a person's yes. Pure. */
export function receiptNeedsYes(qty: number, turn: Pick<Turn, 'words'> | null, poNumber?: string | null): boolean {
  if (!turn) return true
  return !statedNumbers(turn.words, poNumber).has(Math.abs(qty))
}

export type ReceiptCall = {
  type: string
  productVariantId?: string | null
  componentId?: string | null
  locationId?: string | null
  atVendorId?: string | null
  deltaQty: number
  poNumber?: string | null
}

type Held = ReceiptCall & { createdAt: Date; turnId: string; personId: string | null; usedAt: Date | null }

/** Why a held line cannot be logged by this call, or null when it can. Pure. */
export function heldProblem(held: Held | null, call: ReceiptCall, turn: Turn | null, now: number): string | null {
  if (!held) return 'There is no held receipt with that id.'
  if (held.usedAt) return 'That held receipt was already logged.'
  if (now - held.createdAt.getTime() > HOLD_MS) return 'That held receipt has lapsed (over two days old). Show the person the line again and ask.'
  if (!turn) return 'A held receipt can only be logged from a conversation turn.'
  if (held.turnId === turn.id) {
    return 'It was held in this same turn, so the person has not answered yet. Show them the held line and wait for their reply.'
  }
  if (held.personId && held.personId !== turn.personId) return 'It was held for someone else; only they can say yes to it.'
  const same = (a?: string | null, b?: string | null) => (a ?? null) === (b ?? null)
  if (held.type !== call.type) return `That held line is a ${held.type}, not a ${call.type}.`
  if (!same(held.productVariantId, call.productVariantId) || !same(held.componentId, call.componentId)) return 'That held receipt is for a different item.'
  if (!same(held.locationId, call.locationId) || !same(held.atVendorId, call.atVendorId)) return 'That held receipt is for a different place.'
  if (Number(held.deltaQty) !== Number(call.deltaQty)) return `That held receipt is for ${Number(held.deltaQty)}, not ${call.deltaQty}. If the person gave a different number, log that number (it is now in their words).`
  if (!same(held.poNumber, call.poNumber)) return 'That held receipt is for a different purchase order.'
  return null
}

/** Hold a receipt for a person's yes. Returns the held line's id. */
export async function holdReceipt(call: ReceiptCall, label: string): Promise<string> {
  const turn = currentTurn()
  const r = await db.pendingReceipt.create({
    data: {
      turnId: turn?.id ?? 'no-turn', personId: turn?.personId ?? null,
      productVariantId: call.productVariantId ?? null, componentId: call.componentId ?? null,
      locationId: call.locationId ?? null, atVendorId: call.atVendorId ?? null, type: call.type,
      deltaQty: String(call.deltaQty), poNumber: call.poNumber ?? null, label,
    },
    select: { id: true },
  })
  return r.id
}

/**
 * Claim a held line for logging: checked, then marked used in one statement,
 * so two calls cannot both spend it. Returns why not, or null once claimed.
 */
export async function claimHeld(id: string, call: ReceiptCall): Promise<string | null> {
  const held = await db.pendingReceipt.findUnique({ where: { id } })
  const problem = heldProblem(held ? { ...held, deltaQty: Number(held.deltaQty) } : null, call, currentTurn(), Date.now())
  if (problem) return problem
  const r = await db.pendingReceipt.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } })
  return r.count === 1 ? null : 'That held receipt was already logged.'
}

export async function releaseHeld(id: string) {
  await db.pendingReceipt.updateMany({ where: { id, usedEventId: null }, data: { usedAt: null } })
}

export async function markHeldLogged(id: string, eventId: string) {
  await db.pendingReceipt.update({ where: { id }, data: { usedEventId: eventId } })
}

/** The block code adds to the reply when anything was held this turn. Pure. */
export function heldBlock(lines: string[]): string {
  if (!lines.length) return ''
  return [
    'Not logged yet. These wait for your yes, because the numbers were not ones you gave:',
    ...lines.map((l) => `- ${l}`),
    'Say yes to log them as they are, or give the real numbers.',
  ].join('\n')
}

export async function heldThisTurn(turnId: string): Promise<string[]> {
  const rows = await db.pendingReceipt.findMany({ where: { turnId, usedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, label: true } })
  // The id stays on the line: on the person's yes, Mouse reads it back from
  // its own reply (chat) or the quoted email to name what it is logging.
  return rows.map((r) => `${r.label} (held ${r.id})`)
}
