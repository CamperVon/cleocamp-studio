/**
 * Customer support, the parts with no database and no network — so every rule
 * here is tested (tests/support-core.test.ts).
 *
 * Mail to support@cleocamp.com is a Google group that forwards to
 * support@send.cleocamp.com, where Resend hands it to the app. Brandon,
 * 23 Sept 2026: Mouse should monitor customer email, flag fires, and later
 * answer on the team's behalf with approval — signed by Jane, approved by
 * Brandon, Cleo or Jane.
 */

export const SUPPORT_MAILBOX = 'support'

export const CATEGORIES = [
  'WRONG_ITEM', 'DAMAGED', 'WHERE_IS_MY_ORDER', 'RETURN_EXCHANGE', 'SIZING_QUESTION',
  'PRODUCT_QUESTION', 'ORDER_CHANGE', 'WHOLESALE', 'PRESS', 'COMPLIMENT', 'SPAM', 'OTHER',
] as const
export type Category = (typeof CATEGORIES)[number]

export const URGENCIES = ['NOW', 'TODAY', 'DIGEST'] as const
export type Urgency = (typeof URGENCIES)[number]

export const CATEGORY_LABEL: Record<Category, string> = {
  WRONG_ITEM: 'Wrong item',
  DAMAGED: 'Damaged',
  WHERE_IS_MY_ORDER: "Where's my order",
  RETURN_EXCHANGE: 'Return / exchange',
  SIZING_QUESTION: 'Sizing question',
  PRODUCT_QUESTION: 'Product question',
  ORDER_CHANGE: 'Change to an order',
  WHOLESALE: 'Wholesale',
  PRESS: 'Press / collab',
  COMPLIMENT: 'Compliment',
  SPAM: 'Spam',
  OTHER: 'Other',
}

/** True for mail that came in through support@, not Mouse's own inbox. */
export function isSupportMail(toAddress: string): boolean {
  return toAddress
    .toLowerCase()
    .split(',')
    .map((a) => a.trim().replace(/^.*</, '').replace(/>.*$/, '').split('@')[0])
    .includes(SUPPORT_MAILBOX)
}

/**
 * Google appends its own footer to every message a group delivers:
 * "To unsubscribe from this group and stop receiving emails from it, send an
 * email to support+unsubscribe@cleocamp.com." Never the customer's words, and
 * never something to act on.
 */
export function stripGroupFooter(text: string): string {
  return text
    .replace(/\n*-*\s*\n*You received this message because you are subscribed to the Google Groups[\s\S]*$/i, '')
    .replace(/\n*To unsubscribe from this group and stop receiving emails from it,[\s\S]*$/i, '')
    .trim()
}

/**
 * The customer's own address.
 *
 * Usually the From line, which Google leaves alone. But when the sender's
 * domain has a strict DMARC policy (Yahoo, AOL, some company domains) Google
 * rewrites From to the group itself — "Name via Support
 * <support@cleocamp.com>" — and puts the real address in Reply-To. Replying
 * to the group would be replying to ourselves.
 */
export function customerAddress(from: string, replyTo?: string | string[] | null): { email: string; name: string | null } {
  const parse = (s: string) => {
    const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
    // Google quotes the display name it rewrites: 'Ana Ruiz' via Support.
    const name = m?.[1].trim().replace(/^['"]|['"](?=\s+via\s|$)/g, '').trim()
    return m ? { email: m[2].trim().toLowerCase(), name: name || null } : { email: s.trim().toLowerCase(), name: null }
  }
  const f = parse(from)
  const viaGroup = f.email.split('@')[0] === SUPPORT_MAILBOX || /\bvia support\b/i.test(from)
  const rt = Array.isArray(replyTo) ? replyTo[0] : replyTo
  if (viaGroup && rt) {
    const r = parse(rt)
    return { email: r.email, name: r.name ?? f.name?.replace(/\s+via\s+support$/i, '') ?? null }
  }
  return { email: f.email, name: f.name?.replace(/\s+via\s+support$/i, '') ?? null }
}

/** "Re: Fwd: RE: Wrong size!!" and "Wrong size" are the same conversation. */
export function normalizeSubject(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/^\s*((re|fwd?|aw|sv|tr)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Order numbers as a customer writes them — "#1042", "order 1042", "order
 * no. 1042". Four or more digits, so a size or a price is not mistaken for
 * one. Returned in Shopify's own "#1042" form.
 */
export function orderNumbersIn(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(/(?:#\s?|\border\s*(?:no\.?|number|num|#)?\s*(?:is\s+|was\s+)?:?\s*#?)(\d{4,6})\b/gi)) {
    found.add(`#${m[1]}`)
  }
  return [...found]
}

export type Verdict = { category: Category; urgency: Urgency; summary: string | null; customerName: string | null }

/**
 * The model's reply, checked. It is asked for JSON; anything that is not one
 * of the allowed values falls back to OTHER / TODAY — a case a person looks at
 * today, rather than a guess that hides it.
 */
export function parseVerdict(raw: string): Verdict {
  const fallback: Verdict = { category: 'OTHER', urgency: 'TODAY', summary: null, customerName: null }
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return fallback
  try {
    const o = JSON.parse(json) as Record<string, unknown>
    const category = CATEGORIES.includes(o.category as Category) ? (o.category as Category) : 'OTHER'
    const urgency = URGENCIES.includes(o.urgency as Urgency) ? (o.urgency as Urgency) : 'TODAY'
    const summary = typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim().slice(0, 400) : null
    const customerName = typeof o.customerName === 'string' && o.customerName.trim() ? o.customerName.trim().slice(0, 80) : null
    return { category, urgency, summary, customerName }
  } catch {
    return fallback
  }
}

/**
 * The fire rules, decided in code on top of whatever the model said, so the
 * ones that matter most do not depend on a model's judgement on the night.
 * Only ever raises urgency, never lowers it — except spam, which is nobody's
 * fire.
 */
export function finalUrgency(args: {
  verdict: Verdict
  text: string
  inboundCount: number
  orderCreatedAt?: string | null
  orderFulfilled?: boolean
  now?: Date
}): Urgency {
  const { verdict, text } = args
  if (verdict.category === 'SPAM') return 'DIGEST'
  const rank = { DIGEST: 0, TODAY: 1, NOW: 2 } as const
  let u: Urgency = verdict.urgency
  const raise = (to: Urgency) => { if (rank[to] > rank[u]) u = to }

  // Money and reputation: a dispute, a threat, anything legal.
  if (/\b(charge\s?back|dispute[ds]?|lawyer|attorney|legal action|small claims|bbb|better business bureau|fraud|scam|report(ing)? you)\b/i.test(text)) raise('NOW')
  // Wholesale and press are opportunities with a clock on them.
  if (verdict.category === 'WHOLESALE' || verdict.category === 'PRESS') raise('NOW')
  // The third email on the same case without an answer.
  if (args.inboundCount >= 3) raise('NOW')
  // Where's my order, on an order more than two weeks old.
  if (verdict.category === 'WHERE_IS_MY_ORDER' && args.orderCreatedAt) {
    const days = ((args.now ?? new Date()).getTime() - Date.parse(args.orderCreatedAt)) / 864e5
    if (days > 14) raise('NOW')
  }
  // Wrong or damaged is always at least today.
  if (verdict.category === 'WRONG_ITEM' || verdict.category === 'DAMAGED') raise('TODAY')
  return u
}
