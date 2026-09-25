/**
 * Customer support, the parts with no database and no network — so every rule
 * here is tested (tests/support-core.test.ts).
 *
 * Mail to support@cleocamp.com is a Google group that forwards to
 * support@send.cleocamp.com, where Resend hands it to the app. Brandon,
 * 23 Sept 2026: Mouse should monitor customer email, flag fires, and later
 * answer on the team's behalf with approval, approved by Brandon, Cleo or
 * Jane. Replies sign "Kindly, Cleo Studio" (24 Sept 2026) — see reply.ts.
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
  // The third email since the team last answered. Counts only what has gone
  // unanswered — see unansweredCount.
  if (args.inboundCount >= 3) raise('NOW')
  // Where's my order, on an order more than two weeks old.
  if (verdict.category === 'WHERE_IS_MY_ORDER' && args.orderCreatedAt) {
    const days = ((args.now ?? new Date()).getTime() - Date.parse(args.orderCreatedAt)) / 864e5
    if (days > 14) raise('NOW')
  }
  // A change to an order that has not shipped races the packing table:
  // labels are printed as orders are packed (Brandon, 24 Sept 2026), so once
  // it is packed the change is too late.
  if (verdict.category === 'ORDER_CHANGE' && args.orderFulfilled === false) raise('NOW')
  // Wrong or damaged is always at least today.
  if (verdict.category === 'WRONG_ITEM' || verdict.category === 'DAMAGED') raise('TODAY')
  return u
}

/**
 * The customer inside a forward. When Cleo, Brandon, Jane or studio@ forwards
 * an old customer email to support@ (Brandon, 24 Sept 2026: "forwarded emails
 * from cleo, brandon or jane or studio will all be safe"), the case belongs to
 * whoever the forwarded message was FROM, not to the teammate who forwarded
 * it. Gmail's "---------- Forwarded message ---------" and Apple Mail's
 * "Begin forwarded message:" are both read. Returns null when the email is
 * not a forward, or names no sender — then it is just a teammate writing.
 */
export function forwardedOrigin(body: string): { email: string; name: string | null; subject: string | null; body: string; to: string | null; toName: string | null } | null {
  const marker = body.search(/-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:/i)
  if (marker < 0) return null
  const rest = body.slice(marker).replace(/^.*\n/, '')
  // The header block: lines up to the first blank line after "From:".
  const from = rest.match(/^\s*>?\s*From:\s*(.+)$/im)?.[1]?.trim()
  if (!from) return null
  const addr = from.match(/<([^>\s]+@[^>\s]+)>/)?.[1] ?? from.match(/([^\s<>"]+@[^\s<>"]+)/)?.[1]
  if (!addr) return null
  // Strip the quotes around a display name, not the apostrophe in O'Connell.
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim().replace(/^'(.*)'$/, '$1') || null
  const subject = rest.match(/^\s*>?\s*Subject:\s*(.+)$/im)?.[1]?.trim() ?? null
  // Who the forwarded message went TO: when a teammate forwards their own
  // reply, the customer is here, not in From.
  const toLine = rest.slice(0, Math.max(0, rest.search(/\n\s*\n/)) || undefined).match(/^\s*>?\s*To:\s*(.+)$/im)?.[1]?.trim()
  const to = toLine ? (toLine.match(/<([^>\s]+@[^>\s]+)>/)?.[1] ?? toLine.match(/([^\s<>",]+@[^\s<>",]+)/)?.[1] ?? null) : null
  const toName = toLine ? toLine.split(',')[0].replace(/<[^>]*>/, '').replace(/"/g, '').trim() || null : null
  // Everything after the header block is the customer's message (with any
  // earlier thread quoted under it, which the reader is given too).
  const headerEnd = rest.search(/\n\s*\n/)
  const inner = (headerEnd >= 0 ? rest.slice(headerEnd) : rest).trim()
  return {
    email: addr.toLowerCase(), name: name && name !== addr ? name : null, subject, body: inner,
    to: to?.toLowerCase() ?? null, toName: toName && to && toName.toLowerCase() !== to.toLowerCase() ? toName : null,
  }
}

/**
 * How many customer emails are waiting on the team, counting the one just
 * arrived: everything inbound since a person last replied. The auto-reply is
 * not a reply — it says only that the email arrived.
 *
 * This used to count every inbound message on the case. On 25 Sept 2026 Leah
 * wrote once, Brandon answered, and she sent two more four minutes later;
 * three in all, so an alert went to the whole team about a discount-code
 * question that had been answered minutes before. Brandon: "This is not
 * worthy of fire email."
 */
export function unansweredCount(messages: { direction: string; fromAddress: string | null }[]): number {
  let n = 1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.direction === 'OUTBOUND' && m.fromAddress !== 'Auto-reply') break
    if (m.direction === 'INBOUND') n++
  }
  return n
}

/**
 * A customer's message without the earlier emails quoted under it.
 *
 * Brandon, 25 Sept 2026: "do we need all the fat at the bottom of some of the
 * customer emails?" MacKenzie's two-line cancellation request came with the
 * whole Shopify thank-you email quoted underneath, unsubscribe links and
 * all; Amanda's was 5,175 characters. It cluttered the case, and every
 * character of it went to the sorting and drafting models too.
 *
 * Cut at the first sign of quoted history: Gmail's "On … wrote:" (which can
 * wrap onto a second line), Outlook's "From: … Sent:" header or a line of
 * underscores before it, "Original Message", or a trailing run of ">" lines.
 * The full text stays in the stored email; this is what is shown and read.
 * If cutting would leave almost nothing, the message is returned whole.
 */
export function trimQuoted(text: string): { text: string; trimmed: boolean } {
  const cuts = [
    /\n[ \t]*On [^\n]{3,200}?(?:\n[^\n]{0,200}?)?\bwrote:[ \t]*(?:\n|$)/i,
    /\n[ \t]*-{2,}\s*Original Message\s*-{2,}/i,
    /\n[ \t]*_{8,}\s*\n\s*From:/i,
    /\n[ \t]*From:[^\n]+\n[ \t]*(?:Sent|Date):[^\n]+\n/i,
    /\n(?:[ \t]*>[^\n]*(?:\n|$)){2,}[\s>]*$/,
  ]
  let at = text.length
  for (const re of cuts) {
    const m = re.exec(text)
    if (m && m.index < at) at = m.index
  }
  const kept = text.slice(0, at).trimEnd()
  if (at === text.length || kept.replace(/\s/g, '').length < 15) return { text, trimmed: false }
  return { text: kept, trimmed: true }
}

/**
 * Is the person writing in plausibly the person on the order, when they write
 * from a different address? Brandon, 25 Sept 2026: "people often email with a
 * different email address." Serena wrote from her NYU address about #2355,
 * placed as serena.j.song@outlook.com; Corinne wrote from her work address and
 * from eandclammers@msn.com about #2421, placed as corilammers@msn.com.
 *
 * A match is the sender's first name equal to the first name on the order, or
 * the order's surname (4+ letters) inside the sender's address. An order
 * number is guessable, so a number alone is never enough.
 */
export function namesMatch(senderName: string | null | undefined, senderEmail: string, orderNames: Array<string | null | undefined>): boolean {
  const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter((w) => w.length > 1)
  const first = words(senderName ?? '')[0]
  const local = senderEmail.toLowerCase().split('@')[0].replace(/[^a-z]/g, '')
  return orderNames.some((n) => {
    const w = words(n ?? '')
    if (!w.length) return false
    if (first && w[0] === first) return true
    const last = w[w.length - 1]
    return w.length > 1 && last.length >= 4 && local.includes(last)
  })
}
