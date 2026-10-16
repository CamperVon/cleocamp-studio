import type Anthropic from '@anthropic-ai/sdk'

/**
 * The system prompt as cache blocks, in prefix order (6 Oct 2026, phase 1
 * of the cost plan). Pure, so the layout is tested rather than trusted.
 *
 *   1. SYSTEM_RULES                       mark, 1 hour  (with the tools ahead of it)
 *   2. per-caller extra rules, practice   no mark (they vary by caller)
 *   3. stable catalogue                   mark, 1 hour
 *   4. live catalogue                     mark, 5 minutes
 *   5. live tail                          mark, 5 minutes (MOUSE_CACHE_LIVE_TAIL=1, chat turns only)
 *
 * Anthropic API facts this relies on (prompt caching, GA, no beta header):
 * the prefix renders tools, then system, then messages; at most 4
 * cache_control marks per request; ttl "1h" is accepted on a mark and the
 * default is 5 minutes; a mark with a longer TTL must come before one with a
 * shorter TTL; a byte change anywhere in the prefix invalidates every mark
 * after it. No mark is placed in the conversation history, and no automatic
 * (top-level) cache_control is used.
 *
 * ALL FOUR SLOTS ARE USED when the live tail is on (12 Oct 2026, a review
 * build to be measured): rules, stable, live head and live tail each take
 * one. Automatic conversation caching (a top-level cache_control, or a mark
 * in the messages) needs a slot of its own, so it CANNOT be turned on at the
 * same time as the tail; the API refuses a fifth mark. The two are
 * alternatives to be measured against each other, not stacked. With the
 * tail off this uses 3 marks, as before.
 *
 * Why the tail: the live block (about 42,000 tokens) was written again on
 * 22 of 31 compared chat turns on 12 Oct, mostly because the turn itself
 * had changed a to-do, a note or an order. The sections that change most
 * (lib/mouse/context.ts TAIL_SECTIONS) go last behind their own mark, so a
 * change there rewrites about 5,700 tokens instead of all of it. A change
 * in the head still rewrites the head and the tail, as before.
 */
export const CATALOG_HEADING = '# What you currently know\n\n'

export function systemBlocks(o: {
  rules: string
  extraRules?: string | null
  practiceRules?: string | null
  catalog?: { stable: string; live: string; tail?: string } | null
}): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: o.rules, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ]
  if (o.extraRules) blocks.push({ type: 'text', text: o.extraRules })
  if (o.practiceRules) blocks.push({ type: 'text', text: o.practiceRules })
  if (o.catalog) {
    const { stable, live, tail = '' } = o.catalog
    // The heading opens whichever block comes first, so the text Mouse reads
    // starts the same way it always did.
    let headed = false
    const heading = () => (headed ? '' : ((headed = true), CATALOG_HEADING))
    if (stable) blocks.push({ type: 'text', text: heading() + stable, cache_control: { type: 'ephemeral', ttl: '1h' } })
    if (live || (!stable && !tail)) blocks.push({ type: 'text', text: heading() + live, cache_control: { type: 'ephemeral' } })
    if (tail) blocks.push({ type: 'text', text: heading() + tail, cache_control: { type: 'ephemeral' } })
  }
  return blocks
}

/**
 * The system prompt for the transient-state layout (lib/mouse/transient.ts,
 * 16 Oct 2026, review build): the rules, then the stable core with the
 * layout's own rules at its head. Two marks, both one hour; the history and
 * the turn take the other two (layoutTransientMessages). No business data
 * that changes by the day is in here: it all goes in the state, after the
 * last mark. Pure.
 *
 *   1. SYSTEM_RULES                         mark, 1 hour (with the tools ahead of it)
 *   2. per-caller extra rules, practice     no mark
 *   3. TRANSIENT_RULES + stable core        mark, 1 hour
 */
export function coreSystemBlocks(o: { rules: string; extraRules?: string | null; practiceRules?: string | null; transientRules: string; core: string }): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: o.rules, cache_control: { type: 'ephemeral', ttl: '1h' } }]
  if (o.extraRules) blocks.push({ type: 'text', text: o.extraRules })
  if (o.practiceRules) blocks.push({ type: 'text', text: o.practiceRules })
  blocks.push({ type: 'text', text: `${o.transientRules}\n\n${CATALOG_HEADING}${o.core}`, cache_control: { type: 'ephemeral', ttl: '1h' } })
  return blocks
}

/**
 * The request as sent in this layout. A copy: the loop's own messages are
 * never changed, so the state is never carried into the next request or
 * saved. Marks: the last block of the history (1 hour) and the last block of
 * the turn so far (5 minutes); the state goes after both, in the last
 * message, which is always the person's or a tool result. Pure.
 */
export function layoutTransientMessages(messages: Anthropic.MessageParam[], historyLength: number, state: string): Anthropic.MessageParam[] {
  const asBlocks = (c: Anthropic.MessageParam['content']): Anthropic.ContentBlockParam[] =>
    typeof c === 'string' ? [{ type: 'text', text: c }] : c.map((b) => ({ ...b }) as Anthropic.ContentBlockParam)
  const out = messages.map((m) => ({ ...m, content: asBlocks(m.content) }))
  const mark = (i: number, ttl: '1h' | '5m') => {
    const blocks = out[i]?.content as Anthropic.ContentBlockParam[] | undefined
    if (!blocks?.length) return
    // A thinking block cannot carry a mark; the last block that can, does.
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k] as { type: string }
      if (b.type === 'thinking' || b.type === 'redacted_thinking') continue
      ;(blocks[k] as { cache_control?: unknown }).cache_control = ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }
      return
    }
  }
  if (historyLength > 0 && historyLength < out.length) mark(historyLength - 1, '1h')
  mark(out.length - 1, '5m')
  const last = out[out.length - 1]
  if (last?.role !== 'user') throw new Error('the state goes in a user message; the request must end with one')
  ;(last.content as Anthropic.ContentBlockParam[]).push({ type: 'text', text: state })
  return out
}
