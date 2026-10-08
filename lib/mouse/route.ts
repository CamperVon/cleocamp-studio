/**
 * Which model answers a chat turn (approved 7 Oct 2026, behind
 * MOUSE_READ_LANE, off by default). Opus at high effort is the default and
 * the answer to any doubt. Only a short, plain, single question with nothing
 * in it that could be a request to act, a fact to record, a correction or a
 * call for judgement goes to the read lane: Sonnet at medium effort with
 * look-up tools only (lib/mouse/agent.ts READ_LANE_TOOLS). Code decides, no
 * model. Deliberately harsh: "Is the Calamo PO paid?" goes to Opus because of
 * "paid". That costs money, never safety.
 */

export type Lane = 'opus' | 'read'
export type Route = { lane: Lane; reason: string }

export type RouteContext = {
  /** MOUSE_READ_LANE is on. */
  enabled: boolean
  /** Which door the turn came through; only "chat" qualifies. */
  source: string
  practice: boolean
  /** Files attached to this turn. */
  hasAttachments: boolean
  /** Files from earlier messages riding along with this turn. */
  filesInHistory: boolean
  /** Mouse's previous reply in this thread, if any. */
  lastReply: string | null
}

/** Every form of every word that could mean "do something" or "record this", irregular ones spelt out. */
const ACTION_WORDS = new Set(`
add adds added adding update updates updated updating send sends sent sending order orders ordered ordering
record records recorded recording correct corrects corrected correcting correction pay pays paid paying payment
receive receives received receiving receipt move moves moved moving delete deletes deleted deleting
change changes changed changing log logs logged logging set sets setting mark marks marked marking
make makes made making create creates created creating cancel cancels canceled cancelled canceling cancelling
refund refunds refunded refunding remove removes removed removing retire retires retired retiring
merge merges merged merging transfer transfers transferred transferring ship ships shipped shipping shipment
email emails emailed emailing invoice invoices invoiced invoicing draft drafts drafted drafting
schedule schedules scheduled scheduling remind reminds reminded reminding reminder todo to-do todos to-dos
note notes noted noting save saves saved saving keep keeps kept keeping file files filed filing
put puts putting book books booked booking buy buys bought buying approve approves approved approving
confirm confirms confirmed confirming fix fixes fixed fixing edit edits edited editing rename renames renamed renaming
count counts counted counting give gives gave given giving gift gifts gifted gifting return returns returned returning
use uses used using split splits splitting reorder reorders reordered reordering
`.trim().split(/\s+/))

/** Politeness that wraps a request, and words that correct. */
const REQUEST_OR_CORRECTION = [
  /\bplease\b/, /\bpls\b/, /\bplz\b/, /\b(can|could|would|will) you\b/, /\bi need you\b/, /\blet'?s\b/, /\bgo ahead\b/,
  /\bno\b/, /\bnope\b/, /\bnot\b/, /n't\b/, /\bwrong\b/, /\bactually\b/, /\binstead\b/, /\bmeant\b/, /\bmistake\b/,
  /\bshould be\b/, /\bsorry\b/, /\boops\b/,
]

/** Asking for judgement, which stays with Opus. */
const JUDGEMENT = /\b(why|should|recommend\w*|suggest\w*|plan\w*|best|compare\w*|forecast\w*|decide\w*|ought|worth)\b/

/**
 * What only an Opus tool can answer (READ_LANE_LEAVES_TO_OPUS in agent.ts):
 * a kept document or picture (read_file) or a draft order's link
 * (draft_order_links). Decided here, by code, so the read lane is never left
 * to notice it lacks the tool (8 Oct 2026). "file" is already an action word.
 */
export const NEEDS_OPUS_TOOL = /\b(pdfs?|photos?|pictures?|images?|attachments?|scans?|spec sheets?|colou?r cards?|tech packs?|draft orders?|payment links?|invoice links?|checkout links?)\b/

/** "Think hard", "use Opus" and the like always get Opus. */
const OVERRIDE = /\b(think(ing)? (hard|harder|carefully|deeply|it through)|really think|opus|careful(ly)?|deep(ly)?|deep dive|high effort|take your time)\b/

/** A second clause joined on: "… and also …", "… ; …", "… — …". */
const JOINED = /\b(and|also|then|plus)\b|;|&| - | — | – /

const QUESTION_WORDS = new Set(['what', "what's", 'whats', 'which', 'who', "who's", 'whose', 'when', 'where', "where's", 'how', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'has', 'have', 'any'])

/** The person's own words: chat prefixes the author ("[Cleo, owner] ") and a page box ("(Typed in the box on the Products page.) "). Pure. */
export function ownWords(message: string): { text: string; fromPageBox: boolean } {
  let t = message.trim()
  t = t.replace(/^\[[^\]\n]{1,80}\]\s*/, '')
  const box = /^\(Typed in the box on the [^)]+ page\.\)\s*/.exec(t)
  if (box) t = t.slice(box[0].length)
  return { text: t.trim(), fromPageBox: !!box }
}

/** Which lane a chat turn takes, and the first rule that decided it. Pure. */
export function routeChat(message: string, ctx: RouteContext): Route {
  const opus = (reason: string): Route => ({ lane: 'opus', reason })
  if (!ctx.enabled) return opus('switch-off')
  if (ctx.source !== 'chat') return opus(`source:${ctx.source}`)
  if (ctx.practice) return opus('practice')
  if (ctx.hasAttachments) return opus('attachment')
  if (ctx.filesInHistory) return opus('files-in-history')

  const { text, fromPageBox } = ownWords(message)
  const lower = text.toLowerCase().replace(/[’‘]/g, "'")
  if (OVERRIDE.test(lower)) return opus('override')
  // Mouse asked something last time: this is probably the answer, which is a fact to record.
  if (ctx.lastReply && ctx.lastReply.includes('?')) return opus('after-question')
  // A page's box is for notes to Mouse.
  if (fromPageBox) return opus('page-box')

  if (!text || text.length > 200) return opus('length')
  if (/[\r\n]/.test(text)) return opus('multi-line')
  if ((text.match(/\?/g) ?? []).length > 1) return opus('several-questions')
  if (JOINED.test(lower)) return opus('joined-clauses')
  if (!/^[\x20-\x7e]+$/.test(text.replace(/[’‘]/g, "'"))) return opus('not-plain-english')

  const words = lower.split(/[^a-z0-9'-]+/).filter(Boolean)
  if (words.length < 3) return opus('too-short')
  const action = words.find((w) => ACTION_WORDS.has(w) || ACTION_WORDS.has(w.replace(/'s$/, '')))
  if (action) return opus(`verb:${action}`)
  if (REQUEST_OR_CORRECTION.some((r) => r.test(lower))) return opus('request-or-correction')
  if (JUDGEMENT.test(lower)) return opus('judgement')
  if (NEEDS_OPUS_TOOL.test(lower)) return opus('needs-opus-tool')
  if (!QUESTION_WORDS.has(words[0])) return opus('not-a-question')

  return { lane: 'read', reason: 'read-eligible' }
}
