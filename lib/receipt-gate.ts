/**
 * Stock added only on a person's own, specific word (16 Oct 2026).
 *
 * The shadow bake-off asked Mouse "PO 2360 arrived in full today." One run
 * asked what "in full" covered; the other logged the White tees as received
 * at the quantities the PO still owed, and closed a to-do, before anyone had
 * said a number. Practice mode stopped it. Whether Mouse asks first depended
 * on which context it happened to see, so code decides, and Codex's review
 * of the first version set the bar: a number alone is not a statement, and
 * a later "yes" read by the model is not a confirmation.
 *
 * A RECEIVED entry, a COUNTED number or an upward MANUAL_ADJUST (the three
 * ways stock is added) goes in at once only when the person's own words in
 * THIS message state it: the item named (product, colour and size, or the
 * component), the number tied to that item by where it sits in the sentence,
 * and for a receipt on a purchase order, the PO's number. Mouse's replies,
 * earlier messages and quoted mail never count. Anything else is held.
 *
 * A held line gets a short code. Code adds every held line, with its code, to
 * the reply. It is logged only when a later message from the same, known
 * person contains "LOG <code>": code reads that before the model runs and
 * logs exactly the held line, once. The model has no way to log a held line
 * at all. An unknown person (the shared sign-in, a tool called outside a
 * run) can neither have a line held for them nor confirm one; both fail
 * safe, and nothing is logged. A held line lapses after two days.
 *
 * The decisions are pure functions over injected storage, so the tests run
 * the tool's real path without touching the one, production, database.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** One run: its id, who it is for (null when nobody says), and their own words in this message. */
export type Turn = { id: string; personId: string | null; words: string }

const turnStore = new AsyncLocalStorage<Turn>()

export function inTurn<T>(turn: Turn, fn: () => Promise<T>): Promise<T> {
  return turnStore.run(turn, fn)
}

export function currentTurn(): Turn | null {
  return turnStore.getStore() ?? null
}

/** A held line lapses after this long. */
export const HOLD_MS = 2 * 24 * 60 * 60 * 1000

/** The entry types that add stock, and so are held when nobody stated them. */
export const HELD_TYPES = new Set(['RECEIVED', 'COUNTED', 'MANUAL_ADJUST'])

// ── Reading the person's words ──────────────────────────────────────────────

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b'
/** Numbers that name something rather than count it: dates, times, order and PO numbers. Blanked before reading. */
const NOT_A_COUNT = [
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}`, 'gi'),
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'),
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /#\s*\d+/g,
  /\bPOs?\s*#?\s*\d+/gi,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi,
]
const blank = (t: string) => NOT_A_COUNT.reduce((s, re) => s.replace(re, (m) => ' '.repeat(m.length)), t)

const depl = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
/** Lower-case words, plurals folded ("Tees" is "tee"). Pure. */
export const wordsOf = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(depl)

type Tok = { i: number; raw: string; w: string; num: number | null; punct: boolean }

function tokens(segment: string): Tok[] {
  const out: Tok[] = []
  for (const m of segment.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d])|\d+(?:\.\d+)?|[A-Za-z]+|[,:=\-x×]/g)) {
    const raw = m[0]
    const isNum = /^\d/.test(raw)
    out.push({ i: out.length, raw, w: isNum ? raw : depl(raw.toLowerCase()), num: isNum ? Number(raw.replace(/,/g, '')) : null, punct: /^[,:=\-×]$/.test(raw) })
  }
  return out
}

const SIZE_WORD = new Set(['size', 'sz'])
const sameSize = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() || (/^\d+$/.test(a.trim()) && /^\d+$/.test(b.trim()) && Number(a) === Number(b))

/** Where each of the product's sizes is named: "size 2", "sz 3", or a letter or word size on its own ("XS", "Petite"). */
function sizeMentions(toks: Tok[], sizes: string[]): Array<{ at: number; size: string; numberAt?: number }> {
  const out: Array<{ at: number; size: string; numberAt?: number }> = []
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (SIZE_WORD.has(t.w) || t.w === 'size') {
      // "size 1", "sizes 1, 2 and 3" (a list continues only while a separator and another small number follow)
      let j = k + 1
      while (j < toks.length) {
        const n = toks[j]
        if (n.num === null) break
        const s = sizes.find((x) => sameSize(x, n.raw))
        if (!s) break
        out.push({ at: j, size: s, numberAt: j })
        const sep = toks[j + 1]
        const next = toks[j + 2]
        if (!(sep && (sep.raw === ',' || sep.w === 'and' || sep.w === 'or') && next && next.num !== null && next.num < 10 && toks[j + 3] && (toks[j + 3].punct || toks[j + 3].w === 'and' || toks[j + 3].w === 'or'))) break
        j += 2
      }
      continue
    }
    if (t.num !== null) continue
    for (const s of sizes) {
      if (/^\d+$/.test(s)) continue
      // Letter sizes as written in capitals only, so "s" and "m" in words never count.
      if (/^(xxs|xs|s|m|l|xl|xxl)$/i.test(s) ? t.raw === s.toUpperCase() : t.w === depl(s.toLowerCase())) out.push({ at: k, size: s })
    }
  }
  return out
}

type Mention<T> = { at: number; end: number; value: T }

/** Each place a phrase from the list is named, longest first, so "Long Sleeve Cleo Tee" is not also "Cleo Tee". */
function phraseMentions<T>(toks: Tok[], phrases: Array<{ words: string[]; value: T }>): Mention<T>[] {
  const sorted = phrases.filter((p) => p.words.length).sort((a, b) => b.words.length - a.words.length)
  const out: Mention<T>[] = []
  for (let k = 0; k < toks.length; ) {
    const hit = sorted.find((p) => p.words.every((w, j) => toks[k + j]?.w === w))
    if (hit) { out.push({ at: k, end: k + hit.words.length - 1, value: hit.value }); k += hit.words.length } else k++
  }
  return out
}

/** The nearest mention to token q, or null on a tie between different values. */
function nearest<T>(q: number, ms: Mention<T>[], same: (a: T, b: T) => boolean): T | null {
  let best: { d: number; v: T } | null = null
  let tie = false
  for (const m of ms) {
    const d = q < m.at ? m.at - q : q > m.end ? q - m.end : 0
    if (!best || d < best.d) { best = { d, v: m.value }; tie = false } else if (d === best.d && !same(best.v, m.value)) tie = true
  }
  return best && !tie ? best.v : null
}

/** What names the item, and what names everything it could be mistaken for. */
export type ItemTerms =
  | {
      kind: 'variant'
      /** Product name, style number, SKU: any of these names it. */
      names: string[]
      /** Every other product's names. */
      rivals: string[]
      colour: { mine: string | null; all: string[] }
      size: { mine: string | null; all: string[] }
    }
  | { kind: 'component'; names: string[]; rivals: string[] }

const GENERIC_COLOUR_WORDS = new Set(['leather', 'suede', 'colour', 'color', 'the'])

/** A colour's names: the whole name, and any word of it no other colour of the product shares. Pure. */
function colourPhrases(all: string[]): Array<{ words: string[]; value: string }> {
  const out: Array<{ words: string[]; value: string }> = []
  for (const c of all) {
    out.push({ words: wordsOf(c), value: c })
    for (const w of wordsOf(c)) {
      if (GENERIC_COLOUR_WORDS.has(w)) continue
      if (all.some((o) => o !== c && wordsOf(o).includes(w))) continue
      out.push({ words: [w], value: c })
    }
  }
  return out
}

/**
 * Does the person's own text state this exact stock line: the item, its
 * quantity tied to it, and (on a PO receipt) the PO? Pure.
 */
export function statesStockLine(text: string, qty: number, item: ItemTerms, po: string | null): { ok: true } | { ok: false; why: string } {
  if (!text.trim()) return { ok: false, why: 'no words of the person in this message' }
  if (po && !new RegExp(`(?<![\\d])${po}(?![\\d])`).test(text)) return { ok: false, why: `PO ${po} is not named in their message` }
  const segments = blank(text).split(/\n+|[;!?]|\.(?=\s|$)/)
  const all = tokens(blank(text))

  if (item.kind === 'component') {
    // Every word of its name in the same sentence as the number, and no
    // other component's name there as fully.
    const mine = item.names.map(wordsOf).filter((w) => w.length)
    const rivals = item.rivals.map(wordsOf).filter((w) => w.length)
    for (const seg of segments) {
      const toks = tokens(seg)
      if (!toks.some((t) => t.num === qty)) continue
      const have = new Set(toks.map((t) => t.w))
      const hit = mine.find((ws) => ws.every((w) => have.has(w)))
      if (!hit) continue
      const rival = rivals.find((ws) => ws.every((w) => have.has(w)) && !ws.every((w) => hit.includes(w)))
      if (rival) return { ok: false, why: 'another component is named beside that number' }
      return { ok: true }
    }
    return { ok: false, why: 'the component and that number are not named together' }
  }

  const products = [
    ...item.names.map((n) => ({ words: wordsOf(n), value: 'mine' })),
    ...item.rivals.map((n) => ({ words: wordsOf(n), value: `other:${n}` })),
  ]
  const multiColour = item.colour.all.length > 1 && item.colour.mine
  const multiSize = item.size.all.length > 1 && item.size.mine
  const colours = colourPhrases(item.colour.all)

  // Across the whole message, for a sentence that names none itself.
  const allProducts = phraseMentions(all, products)
  if (!allProducts.some((m) => m.value === 'mine')) return { ok: false, why: 'the product is not named in their message' }
  const only = <T,>(ms: Mention<T>[]) => { const vs = [...new Set(ms.map((m) => m.value))]; return vs.length === 1 ? vs[0] : null }
  const msgProduct = only(allProducts)
  const msgColour = only(phraseMentions(all, colours))
  const msgSize = only(sizeMentions(all, item.size.all).map((m) => ({ at: m.at, end: m.at, value: m.size })))

  for (const seg of segments) {
    const toks = tokens(seg)
    const sizes = sizeMentions(toks, item.size.all)
    const sizeNumberAt = new Set(sizes.map((s) => s.numberAt).filter((n): n is number => n !== undefined))
    const counts = toks.filter((t) => t.num === qty && !sizeNumberAt.has(t.i))
    if (!counts.length) continue
    const pm = phraseMentions(toks, products)
    const cm = phraseMentions(toks, colours)
    const sm = sizes.map((s) => ({ at: s.at, end: s.at, value: s.size }))
    for (const c of counts) {
      const product = pm.length ? nearest(c.i, pm, (a, b) => a === b) : msgProduct
      if (product !== 'mine') continue
      if (multiColour) {
        const colour = cm.length ? nearest(c.i, cm, (a, b) => a === b) : msgColour
        if (colour !== item.colour.mine) continue
      }
      if (multiSize) {
        // "510 size 1" and "size 1: 510" pair a number with its size outright;
        // a comma between them does not.
        const after = sizes.find((s) => s.at === c.i + 1 || (s.at === c.i + 2 && toks[c.i + 1]?.w === 'size') || (s.at === c.i + 3 && toks[c.i + 1]?.w === 'in'))
        const before = sizes.find((s) => s.at === c.i - 1 || (s.at === c.i - 2 && /^[:=\-]$/.test(toks[c.i - 1]?.raw ?? '')))
        const paired = after ?? before
        const size = paired ? paired.size : sm.length ? nearest(c.i, sm, sameSize) : msgSize
        if (!size || !sameSize(size, item.size.mine!)) continue
      }
      return { ok: true }
    }
  }
  return { ok: false, why: 'that number is not tied to this item (product, colour and size) in their message' }
}

// ── Holding and confirming ──────────────────────────────────────────────────

/** Codes avoid letters and digits that read alike (O/0, I/1, B/8, S/5, G/6). */
const CODE_ALPHABET = 'ACDEFHJKMNPRTUVWXY3479'
export function newCode(rand: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]).join('')
}

/** Every "LOG K7Q2" in the person's own words, upper-cased. Pure. */
export function codesIn(words: string): string[] {
  return [...new Set([...words.matchAll(/\bLOG[\s:#-]*([A-Za-z0-9]{4})\b/gi)].map((m) => m[1].toUpperCase()))]
}

export type StockCall = {
  type: string
  productVariantId: string | null
  componentId: string | null
  locationId: string | null
  atVendorId: string | null
  /** The change, or the number counted for COUNTED. */
  qty: number
  poNumber: string | null
  note: string | null
}

export type HeldRow = StockCall & { id: string; code: string; label: string; createdAt: Date; personId: string | null; usedAt: Date | null }

export type GateDeps = {
  terms: (call: StockCall) => Promise<ItemTerms | null>
  label: (call: StockCall) => Promise<string>
  hold: (call: StockCall, label: string, turn: Turn) => Promise<{ id: string; code: string }>
}

/**
 * The tool's gate: null when the person's words state this line (write it),
 * otherwise the held result to return to the model. Unknown person: refused,
 * not held, since nobody could confirm it.
 */
export async function gateStockWrite(call: StockCall, turn: Turn | null, deps: GateDeps): Promise<null | Record<string, unknown>> {
  if (!HELD_TYPES.has(call.type)) return null
  if (call.type !== 'COUNTED' && !(call.qty > 0)) return null
  const terms = await deps.terms(call)
  const stated = turn && terms ? statesStockLine(turn.words, call.qty, terms, call.poNumber) : { ok: false as const, why: 'no person and no words to check' }
  if (stated.ok) return null
  if (!turn?.personId) {
    return {
      applied: false,
      error:
        `Not logged: ${stated.why}, and nobody known is signed in to confirm it. Ask the person to sign in as ` +
        'themselves, or to say the item, number and PO in one message.',
    }
  }
  const label = await deps.label(call)
  const { code } = await deps.hold(call, label, turn)
  return {
    applied: false,
    held: code,
    error:
      `Not logged: ${stated.why}. Held instead: code shows the person "${label}" with the code LOG ${code} under your reply. ` +
      'Ask what actually came, or what the count was. You cannot log a held line: it goes in only when the person ' +
      'writes LOG and its code, or says the item, number and PO in one message. Do not put it in any other way.',
  }
}

export type ConfirmDeps = {
  findOpen: (code: string) => Promise<HeldRow | null>
  claim: (id: string) => Promise<boolean>
  release: (id: string) => Promise<void>
  markLogged: (id: string, eventId: string) => Promise<void>
  write: (row: HeldRow, turn: Turn) => Promise<{ eventId?: string | null; error?: string; reason?: string }>
  now: () => number
}

/**
 * Before the model runs: every "LOG <code>" in the person's own words logs
 * that exact held line, once, if they are the known person it was held for.
 * Returns what was logged and what was refused, as lines for the reply.
 */
export async function confirmFromWords(turn: Turn, deps: ConfirmDeps): Promise<{ logged: string[]; refused: string[] }> {
  const logged: string[] = []
  const refused: string[] = []
  const codes = codesIn(turn.words)
  if (!codes.length) return { logged, refused }
  if (!turn.personId) {
    return { logged, refused: codes.map((c) => `LOG ${c}: not logged, because nobody known is signed in. Sign in as yourself and send it again.`) }
  }
  for (const code of codes) {
    const row = await deps.findOpen(code)
    if (!row) { refused.push(`LOG ${code}: no held line has that code.`); continue }
    if (row.usedAt) { refused.push(`LOG ${code}: already logged.`); continue }
    if (deps.now() - row.createdAt.getTime() > HOLD_MS) { refused.push(`LOG ${code}: lapsed (held over two days ago). Say the numbers again.`); continue }
    if (!row.personId || row.personId !== turn.personId) { refused.push(`LOG ${code}: held for someone else, so only they can log it.`); continue }
    if (!(await deps.claim(row.id))) { refused.push(`LOG ${code}: already logged.`); continue }
    const r: { eventId?: string | null; error?: string; reason?: string } = await deps.write(row, turn).catch((e: unknown) => ({ eventId: null, error: e instanceof Error ? e.message : String(e) }))
    if (r.eventId) { await deps.markLogged(row.id, r.eventId); logged.push(row.label) } else {
      await deps.release(row.id)
      refused.push(`LOG ${code}: ${row.label} was not logged: ${r.error ?? r.reason ?? 'the write did not happen'}`)
    }
  }
  return { logged, refused }
}

/** What code adds to the reply. Pure. */
export function replyBlock(held: Array<{ label: string; code: string }>, confirmed: { logged: string[]; refused: string[] }): string {
  const parts: string[] = []
  if (confirmed.logged.length) parts.push(['Logged on your code:', ...confirmed.logged.map((l) => `- ${l}`)].join('\n'))
  if (confirmed.refused.length) parts.push(confirmed.refused.map((l) => `- ${l}`).join('\n'))
  if (held.length) {
    parts.push([
      'Not logged yet. Each of these waits for you, because your message did not say it:',
      ...held.map((h) => `- ${h.label}. To log exactly this, reply LOG ${h.code}`),
      'Or send the real numbers, naming the item and PO.',
    ].join('\n'))
  }
  return parts.join('\n\n')
}
