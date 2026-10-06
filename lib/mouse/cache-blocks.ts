import type Anthropic from '@anthropic-ai/sdk'

/**
 * The system prompt as cache blocks, in prefix order (6 Oct 2026, phase 1
 * of the cost plan). Pure, so the layout is tested rather than trusted.
 *
 *   1. SYSTEM_RULES                       mark, 1 hour  (with the tools ahead of it)
 *   2. per-caller extra rules, practice   no mark (they vary by caller)
 *   3. stable catalogue                   mark, 1 hour
 *   4. live catalogue                     mark, 5 minutes
 *
 * Anthropic API facts this relies on (prompt caching, GA, no beta header):
 * the prefix renders tools, then system, then messages; at most 4
 * cache_control marks per request; ttl "1h" is accepted on a mark and the
 * default is 5 minutes; a mark with a longer TTL must come before one with a
 * shorter TTL; a byte change anywhere in the prefix invalidates every mark
 * after it. This uses 3 marks. No mark is placed in the conversation
 * history, and no automatic (top-level) cache_control is used.
 */
export const CATALOG_HEADING = '# What you currently know\n\n'

export function systemBlocks(o: {
  rules: string
  extraRules?: string | null
  practiceRules?: string | null
  catalog?: { stable: string; live: string } | null
}): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: o.rules, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ]
  if (o.extraRules) blocks.push({ type: 'text', text: o.extraRules })
  if (o.practiceRules) blocks.push({ type: 'text', text: o.practiceRules })
  if (o.catalog) {
    const { stable, live } = o.catalog
    // The heading opens whichever block comes first, so the text Mouse reads
    // starts the same way it always did.
    if (stable) blocks.push({ type: 'text', text: CATALOG_HEADING + stable, cache_control: { type: 'ephemeral', ttl: '1h' } })
    if (live || !stable) blocks.push({ type: 'text', text: (stable ? '' : CATALOG_HEADING) + live, cache_control: { type: 'ephemeral' } })
  }
  return blocks
}
