import type Anthropic from '@anthropic-ai/sdk'

/**
 * The system prompt as cache blocks, in prefix order (6 Oct 2026, phase 1
 * of the cost plan). Pure, so the layout is tested rather than trusted.
 *
 *   1. SYSTEM_RULES                       mark, 1 hour  (with the tools ahead of it)
 *   2. per-caller extra rules, practice   no mark (they vary by caller)
 *   3. stable catalogue                   mark, 1 hour
 *   4. live catalogue                     mark, 5 minutes
 *   5. live tail                          mark, 5 minutes (MOUSE_CACHE_LIVE_TAIL=1 only)
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
