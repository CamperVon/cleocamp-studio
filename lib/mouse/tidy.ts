import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { buildCatalog } from '@/lib/mouse/context'
import { CHAT_MODEL } from '@/lib/mouse/agent'
import { recordUsage, usageOf } from '@/lib/mouse/usage'

/**
 * The weekly look down the whole "To tend to" list.
 *
 * On 24 Sept 2026, 20 of 67 open items turned out to be answered, past or
 * pointless — the tag count for bag orders that had been reset, a sample
 * question for a PO since cancelled. Mouse only closes an item when someone
 * answers THAT item; nothing ever read the list against what is now on file,
 * so it only grew. Brandon: "why was mouse not doing that anyway?"
 *
 * This reads it, once a week (Monday's nightly run) or when someone asks, and
 * SUGGESTS closings with a one-line reason. It closes nothing itself: a
 * person taps Close or Keep open. That is deliberate — the same day, a
 * correct-looking call made silently (the buttons) cost three corrections.
 * The model here has no tools; it reads and returns JSON.
 */
const REVIEW = `You review the open questions and to-dos of a small clothing studio against
what its records now say. Suggest closing an item ONLY when the records plainly show
it is answered, done, in the past, or no longer relevant (the thing it was about was
cancelled, replaced, or has moved on). Give a one-sentence reason that names the
record or fact that shows it — something a person can check at a glance.

When in doubt, leave it out. Never suggest closing: money that is owed or unpaid,
taxes or legal filings, recurring dated obligations, or anything whose record does
not clearly settle it. A question nobody has answered is not closed just because it
is old.

Reply with ONLY a JSON array, possibly empty:
[{"id": "<item id exactly as given>", "why": "<one sentence>"}]`

export type Suggestion = { id: string; why: string }

/** The model's list, checked: only real open ids, one reason each, nothing else. */
export function parseSuggestions(raw: string, openIds: Set<string>): Suggestion[] {
  const json = raw.match(/\[[\s\S]*\]/)?.[0]
  if (!json) return []
  try {
    const arr = JSON.parse(json) as unknown[]
    const seen = new Set<string>()
    const out: Suggestion[] = []
    for (const x of Array.isArray(arr) ? arr : []) {
      const o = x as { id?: unknown; why?: unknown }
      const id = typeof o.id === 'string' ? o.id.trim() : ''
      const why = typeof o.why === 'string' ? o.why.trim().slice(0, 300) : ''
      if (!id || !why || !openIds.has(id) || seen.has(id)) continue
      seen.add(id)
      out.push({ id, why })
    }
    return out
  } catch {
    return []
  }
}

export async function reviewOpenItems(): Promise<{ reviewed: number; suggested: number }> {
  const monthAgo = new Date(Date.now() - 30 * 864e5)
  const items = await db.actionItem.findMany({
    where: {
      resolved: false,
      kind: { not: 'GAP' },
      closeSuggestion: null,
      OR: [{ keptOpenAt: null }, { keptOpenAt: { lt: monthAgo } }],
    },
    orderBy: { createdAt: 'asc' },
  })
  if (!items.length) return { reviewed: 0, suggested: 0 }

  const list = items.map((i) =>
    `- id ${i.id} (${i.kind}, raised ${i.createdAt.toISOString().slice(0, 10)}${i.dueDate ? `, due ${i.dueDate.toISOString().slice(0, 10)}` : ''}): ${i.title}${i.detail ? ` — ${i.detail.replace(/\s+/g, ' ').slice(0, 600)}` : ''}`,
  ).join('\n')
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' })

  const startedAt = Date.now()
  const res = await new Anthropic().messages.create({
    model: CHAT_MODEL,
    max_tokens: 4000,
    system: [
      { type: 'text', text: REVIEW },
      { type: 'text', text: `# The records as they stand\n\n${await buildCatalog()}` },
    ],
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: `Today is ${today}.\n\nOpen items to review:\n${list}` }],
  })
  await recordUsage('tidy', [usageOf(CHAT_MODEL, res.usage, startedAt)])
  const raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  const suggestions = parseSuggestions(raw, new Set(items.map((i) => i.id)))

  const now = new Date()
  for (const s of suggestions) {
    await db.actionItem.update({ where: { id: s.id }, data: { closeSuggestion: s.why, closeSuggestedAt: now } })
  }
  return { reviewed: items.length, suggested: suggestions.length }
}
