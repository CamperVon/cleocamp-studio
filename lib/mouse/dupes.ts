/**
 * Two items about the same thing (Brandon, 16 Oct 2026: "lots of doubled up
 * todos. can mouse self-clean better?"). The morning list carried the White
 * Cleo Tee pickup three times: a todo, a calendar entry and PO 2360 coming
 * due. create_todo's description told Mouse to check for an open item first;
 * nothing made it, so copies went up anyway.
 *
 * This is word overlap, not judgement: the words that name the thing (people,
 * products, places, numbers) must mostly match. It errs towards "different":
 * a missed duplicate is one more line, a wrong match hides a real task.
 * Pure: no imports.
 */

// Words that say what kind of task it is, not which one.
const STOP = new Set(`a an and or but the to of on in at by for from with without into onto about as is are be been was were it its
this that these those there here what which who whom whose when where why how do does did done doing get got have has had
can could should would will shall may might must not no yes if then than so too very just once still again also only
our their her his them they she he we us you your my me i
please need needs needed ask asks check checks confirm find send set take put make give tell let see look keep go goes
due today tomorrow overdue urgent todo item items question re via per new old next last more some any all each every
cleo brandon jane mouse studio`.split(/\s+/))

// Different words for the same act.
const SAME_WORD: Record<string, string> = { pickup: 'collect', pick: 'collect', collected: 'collect', ready: 'collect', invoiced: 'invoice', shipped: 'ship', refunded: 'refund', ordered: 'order', reorder: 'order' }

/** The words that name the thing, lower case, with numbers and times kept whole. */
// Dates in the wording ("Fri 16 Oct", "Friday", "Oct 16"): the item's own due date says that.
const DAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday)?'
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*'
const DATES = new RegExp(`\\b(?:${DAY}\\.?,?\\s*)?(?:\\d{1,2}\\s+${MONTH}|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?)\\b|\\b${DAY}\\b`, 'gi')

export function keyWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(DATES, ' ').replace(/[’']s\b/g, '').match(/[a-z0-9][a-z0-9:]*/g) ?? []
  return new Set(words
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !/\d/.test(w) ? w.slice(0, -1) : w))
    .map((w) => SAME_WORD[w] ?? w))
}

/** PO numbers and order numbers named in the text: "po-2360", "order-2811". */
export function refs(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\bPO\s*#?\s*(\d{3,5})\b/gi)) out.add(`po-${m[1]}`)
  for (const m of text.matchAll(/#(\d{3,5})\b/g)) out.add(`order-${m[1]}`)
  return out
}

/** Numbers of three digits or more (a PO, an order, a form): two lines naming different ones are different. */
const bigNumbers = (w: Set<string>) => new Set([...w].filter((x) => /^\d{3,}$/.test(x)))

function overlap(a: string, b: string) {
  const [wa, wb] = [keyWords(a), keyWords(b)]
  const [na, nb] = [bigNumbers(wa), bigNumbers(wb)]
  const [ra, rb] = [refs(a), refs(b)]
  const clash = (na.size && nb.size && ![...na].some((n) => nb.has(n))) || (ra.size && rb.size && ![...ra].some((r) => rb.has(r)))
  const shared = [...wa].filter((w) => wb.has(w)).length
  return { clash: !!clash, shared, union: new Set([...wa, ...wb]).size, shorter: Math.min(wa.size, wb.size) }
}

/**
 * Whether two open items are the same task, for stopping a copy going up:
 * strict. Most of all the words in both must be shared, so "Pay CA LLC
 * annual fee" and "Pay CA LLC estimated fee" stay two items.
 */
export function sameThing(a: string, b: string): boolean {
  const o = overlap(a, b)
  return !o.clash && o.shared >= 3 && o.shared / o.union >= 0.6
}

/**
 * Whether two lines on the same day's list are one event told twice, as
 * the White Cleo Tee pickup was: a todo and a calendar entry for the same
 * collection. Looser than sameThing, because the date has already matched.
 */
export function sameEventSameDay(a: string, b: string): boolean {
  const o = overlap(a, b)
  return !o.clash && o.shared >= 3 && o.shared / o.shorter >= 0.5
}

/** The first open item that is the same task as this new one, if any. */
export function findSame<T extends { title: string }>(title: string, open: T[]): T | null {
  return open.find((o) => sameThing(title, o.title)) ?? null
}

export type ListLine = { day: string; source: 'po' | 'run' | 'calendar' | 'todo'; text: string; poNumber?: string }

/**
 * Which lines of one morning's list to drop because another line on the same
 * day already says it (Brandon, 16 Oct 2026, after the pickup at Antonio's
 * came three times). Kept: the todo, which is what someone acts on, over a
 * calendar entry for the same event; and anything naming a PO over that PO's
 * own "due, confirm it is on track" line. Two todos that are the same task
 * keep the first. Returns the indexes to drop. Pure.
 */
export function sameDayRepeats(lines: ListLine[]): Set<number> {
  const drop = new Set<number>()
  const rank = { todo: 0, calendar: 1, run: 2, po: 3 }
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      if (i === j || drop.has(i) || drop.has(j)) continue
      const [a, b] = [lines[i], lines[j]]
      if (a.day !== b.day) continue
      // b is a PO's own due line, and a names that PO.
      if (b.source === 'po' && a.source !== 'po' && b.poNumber && refs(a.text).has(`po-${b.poNumber}`)) { drop.add(j); continue }
      if (a.source === 'po' || b.source === 'po') continue
      const same = a.source === 'todo' && b.source === 'todo' ? sameThing(a.text, b.text) : sameEventSameDay(a.text, b.text)
      if (same && (rank[a.source] < rank[b.source] || (rank[a.source] === rank[b.source] && i < j))) drop.add(j)
    }
  }
  return drop
}
