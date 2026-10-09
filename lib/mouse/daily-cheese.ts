import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'
import { quoteOfTheDay } from '@/lib/quotes'
import { URGENT_WINDOW_DAYS } from '@/lib/production-view'

/**
 * The Daily Cheese — Cleo, 17 Sept 2026, after workshopping it turn by turn:
 * brief, focused only on what is red (overdue or due within
 * URGENT_WINDOW_DAYS — same definition as Products in production, never a
 * second one), no backstory, full sentences telling the reader what to do
 * rather than narrating what happened, no questions section for now, and
 * a calendar entry only counts if Jane is specifically named in it — "Call
 * with Cosmo?" doesn't belong here because Jane isn't on that call.
 * OVERDUE itself has a two-day grace before the word is used at all — see
 * isReallyOverdue below.
 *
 * Deliberately NOT an LLM composition, unlike composeAmReport/composeDigest.
 * Cleo's own words: "no opus overwriting or explaining or exaggerations."
 * Every red thing here already has a mechanical reason (a date passed, a
 * date is close, someone said "urgent") — templating it keeps that reason
 * the whole sentence, instead of leaving prose free to invent tone that
 * was never asked for.
 */

const DAY = 864e5

/**
 * Where a line opens in the app. Brandon, 7 Oct 2026: tap a to-do in the
 * email and update it there. The team's phones are signed in, so a link
 * lands on the row itself (app/ui/jump.tsx opens a page at #rec-<id>).
 */
export const APP = 'https://admin.cleocamp.com'

type Item = { on: Date; tag: string; sentence: string; href?: string }

/**
 * The "New" block at the top of an edition: changes to the app no earlier
 * edition announced (lib/whats-new.ts), then what came in from Shopify since
 * the last edition went out (lib/shopify-catchup.ts). Brandon, 8 Oct 2026:
 * "alert the team of this (and all new updates continually) in the daily
 * cheese". Fixed sentences, like everything here. Pure.
 */
export function newLines(app: Array<{ text: string; path?: string }>, fromShopify: string[]): Array<{ text: string; href?: string }> {
  return [
    ...app.map((u) => ({ text: u.text, ...(u.path ? { href: `${APP}${u.path}` } : {}) })),
    ...fromShopify.map((t) => ({ text: `From Shopify: ${t}`, href: `${APP}/products` })),
  ]
}

// Cleo, 17 Sept 2026: "Overdue is so harsh. Let's only make something
// overdue if it's 2 days late. Otherwise make it today." A date that
// passed yesterday reads exactly like one due today — OVERDUE is reserved
// for something that has genuinely sat unresolved a while.
//
// `today` is always UTC-midnight-of-the-LA-day (laMidnight), but PurchaseOrder
// .expectedAt and ActionItem.dueDate are written as noon Pacific — 19:00 UTC,
// via `new Date(dateString + 'T12:00:00-07:00')` — so a raw millisecond diff
// between the two is off by most of a day and can round PO 2371 (genuinely 2
// days late on 17 Sept, due 15 Sept) down to 1. Reconstructing `on` at UTC
// midnight from its own ISO date first removes that offset before diffing.
function daysLate(on: Date, today: Date): number {
  const onMidnight = new Date(on.toISOString().slice(0, 10) + 'T00:00:00Z')
  return Math.round((today.getTime() - onMidnight.getTime()) / DAY)
}
const isReallyOverdue = (on: Date, today: Date) => daysLate(on, today) >= 2

function tag(on: Date, today: Date): string {
  const late = daysLate(on, today)
  if (late >= 2) return 'OVERDUE'
  if (late >= 0) return 'TODAY' // due today, or only 1 day late — same word either way
  const ahead = -late
  if (ahead === 1) return 'TOMORROW'
  return on.toISOString().slice(0, 10).toUpperCase()
}

function duePhrase(on: Date, today: Date): string {
  const late = daysLate(on, today)
  if (late >= 2) return 'It is overdue.'
  if (late >= 0) return 'It is due today.'
  const ahead = -late
  if (ahead === 1) return 'It is due tomorrow.'
  return `It is due ${on.toISOString().slice(0, 10)}.`
}

const period = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

export async function buildDailyCheeseItems(): Promise<Item[]> {
  const today = laMidnight(0)
  const cutoff = laMidnight(-URGENT_WINDOW_DAYS)

  const [pos, runs, events, todos] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
      include: {
        vendor: true,
        lines: { include: { component: true, productVariant: { include: { product: true, colorway: true } } } },
      },
    }),
    db.productionRun.findMany({
      where: { status: { notIn: ['RECEIVED', 'CANCELLED'] } },
      include: { product: true, vendor: true },
    }),
    // A three-day window, same as everything else that's "red" — a calendar
    // entry further out isn't today's problem yet.
    db.calendarEvent.findMany({ where: { date: { gte: today, lte: cutoff } } }),
    db.actionItem.findMany({ where: { resolved: false, kind: 'TODO' } }),
  ])

  const out: Item[] = []
  const coveredProductIds = new Set<string>()

  // ── Orders ────────────────────────────────────────────────
  for (const po of pos) {
    const isPast = !!po.expectedAt && po.expectedAt < today && po.status !== 'PARTIALLY_RECEIVED'
    const dueSoon = !!po.expectedAt && po.expectedAt >= today && po.expectedAt <= cutoff
    // A draft is a normal working state, not a fault. Brandon, 18 Sept 2026:
    // "Sometimes they are going to be drafts for a minute as they are being
    // reviewed internally." Every draft used to appear here the morning after
    // it was written, told to justify itself — PO 2378 was eight hours old and
    // already on the list. A draft earns a mention once it has sat long enough
    // to look forgotten rather than in progress, on the same three days
    // everything else here uses. A draft whose own expected date is close is
    // still caught by dueSoon above, whatever its age.
    const staleDraft = po.status === 'DRAFT' && daysLate(po.createdAt, today) >= URGENT_WINDOW_DAYS
    if (!isPast && !dueSoon && !staleDraft) continue

    for (const l of po.lines) if (l.productVariant) coveredProductIds.add(l.productVariant.product.id)

    const products = [...new Set(po.lines.map((l) => l.productVariant?.product.name).filter(Boolean))] as string[]
    const what = products.length ? products.join(', ') : 'this order'
    const on = po.expectedAt ?? po.orderedAt ?? today

    const sentence = staleDraft
      ? `PO ${po.poNumber} (${po.vendor.name}, ${what}) has been a draft since ` +
        `${po.createdAt.toISOString().slice(0, 10)} and has not gone out.`
      : isPast && isReallyOverdue(on, today)
        ? `PO ${po.poNumber} (${po.vendor.name}, ${what}) is overdue. Confirm when it will ship.`
        : `PO ${po.poNumber} (${po.vendor.name}, ${what}). ${duePhrase(on, today)} Confirm it is on track.`

    out.push({ on, tag: staleDraft ? 'DRAFT' : tag(on, today), sentence, href: `${APP}/po/${encodeURIComponent(po.poNumber)}` })
  }

  // ── Runs at a maker ───────────────────────────────────────
  // Skip a run whose product is already covered by a red order above — a
  // run finishing and its cut-and-sew PO coming due are usually the same
  // shipment told twice, which is exactly the laundry-list problem the
  // three Cleo Bag colourways surfaced in the mockup.
  for (const r of runs) {
    if (!r.expectedReadyAt || coveredProductIds.has(r.productId)) continue
    const isPast = r.expectedReadyAt < today
    const dueSoon = r.expectedReadyAt >= today && r.expectedReadyAt <= cutoff
    if (!isPast && !dueSoon) continue
    const vendor = r.vendor?.name ?? 'the maker'
    const sentence = isPast && isReallyOverdue(r.expectedReadyAt, today)
      ? `${r.product.name} at ${vendor} is overdue. Confirm when it will be ready.`
      : `${r.product.name} at ${vendor}. ${duePhrase(r.expectedReadyAt, today)} Confirm it is ready.`
    out.push({ on: r.expectedReadyAt, tag: tag(r.expectedReadyAt, today), sentence, href: `${APP}/products#rec-${r.productId}` })
  }

  // ── Calendar — only when Jane is actually named ────────────
  // Cleo, 17 Sept: "don't pick up things from the calendar unless Jane is
  // specifically mentioned. Jane is not on that call." A calendar entry is
  // free text written for no one in particular; most of it isn't hers.
  for (const e of events) {
    const mentionsJane = /\bjane\b/i.test(e.title) || (!!e.notes && /\bjane\b/i.test(e.notes))
    if (!mentionsJane) continue
    const sentence = `${period(e.title)} ${duePhrase(e.date, today)}`
    // The calendar lives on Home; there is no page per entry.
    out.push({ on: e.date, tag: tag(e.date, today), sentence, href: `${APP}/` })
  }

  // ── Todos ─────────────────────────────────────────────────
  // Cleo, 17 Sept 2026, on a vendor price-confirmation todo that reached
  // Jane: "Jane would never be confirming prices. So the staples mention is
  // not the kind of thing to send to her." A todo scoped to a VENDOR is a
  // pricing or relationship conversation, not a production or shipping
  // task — that's Cleo and Brandon's to carry, on every edition of this
  // report, not only Jane's. PRODUCT, PRODUCT_VARIANT, COMPONENT,
  // PRODUCTION_RUN and PURCHASE_ORDER stay in; those are the actual
  // shipping-and-manufacturing ground this report is scoped to.
  for (const i of todos.filter((i) => i.entityType !== 'VENDOR')) {
    const isPast = !!i.dueDate && i.dueDate < today
    const window = laMidnight(-(i.remindDaysBefore ?? URGENT_WINDOW_DAYS))
    const dueSoon = !!i.dueDate && i.dueDate >= today && i.dueDate <= window
    const urgentNoDate = i.urgent && !i.dueDate
    if (!isPast && !dueSoon && !urgentNoDate) continue
    const on = urgentNoDate ? today : (i.dueDate ?? i.createdAt)
    const sentence = isPast && isReallyOverdue(i.dueDate!, today)
      ? `${period(i.title)} It is overdue.`
      : urgentNoDate
        ? `${period(i.title)} This is urgent.`
        : `${period(i.title)} ${duePhrase(i.dueDate!, today)}`
    out.push({ on, tag: urgentNoDate ? 'URGENT' : tag(on, today), sentence, href: `${APP}/items#rec-${i.id}` })
  }

  out.sort((a, b) => a.on.getTime() - b.on.getTime())

  // Customer replies Mouse has drafted, waiting on a person's tap. First in
  // the list: a customer is waiting on each one. Brandon, 24 Sept 2026.
  const waiting = await db.supportCase.count({ where: { status: 'OPEN', category: { not: 'SPAM' }, draftReply: { not: null } } })
  // The weekly review's suggestions (Monday), until someone taps them.
  const looksDone = await db.actionItem.count({ where: { resolved: false, closeSuggestion: { not: null } } })
  // Components on no product never show on Products and the forecast cannot
  // count them (Brandon, 7 Oct 2026: "make sure this never happens again").
  // A day's grace, so one added this afternoon is not a fault by morning.
  const orphans = await db.component.count({
    where: { active: true, category: { not: 'PACKAGING' }, usedIn: { none: {} }, createdAt: { lt: new Date(Date.now() - DAY) } },
  })
  if (orphans) {
    out.unshift({
      on: today, tag: 'SET UP',
      sentence: `${orphans} component${orphans === 1 ? ' is' : 's are'} on no product, so ${orphans === 1 ? 'it does' : 'they do'} not show on Products. Say which product each goes into.`,
      href: `${APP}/components`,
    })
  }
  // The style system's loose ends (8 Oct 2026), as one line when there are
  // any; the full list is on the Styles page and in Mouse's context.
  const { styleReport } = await import('@/lib/style-report')
  const styleLines = await styleReport().catch(() => [] as string[])
  if (styleLines.length && !styleLines[0].startsWith('Style system: nothing')) {
    out.unshift({
      on: today, tag: 'STYLES',
      sentence: `Style numbers: ${styleLines.length} thing${styleLines.length === 1 ? '' : 's'} to settle. ${styleLines[0]}`,
      href: `${APP}/products`,
    })
  }
  if (looksDone) {
    out.unshift({
      on: today, tag: 'TIDY',
      sentence: `Mouse thinks ${looksDone} item${looksDone === 1 ? ' is' : 's are'} already done — one tap to close or keep each, on Home.`,
      href: `${APP}/`,
    })
  }
  if (waiting) {
    out.unshift({
      on: today, tag: 'SUPPORT',
      sentence: `${waiting} customer ${waiting === 1 ? 'reply is' : 'replies are'} drafted and waiting for a yes on the Support page.`,
      href: `${APP}/support`,
    })
  }
  return out
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A line's sentence, as a link when it has somewhere to open. Pure. */
export function sentenceHtml(i: Item): string {
  return i.href
    ? `<a href="${escapeHtml(i.href).replace(/"/g, '&quot;')}" style="color:#3A342A;text-decoration:underline;text-decoration-color:#D9A79C;">${escapeHtml(i.sentence)}</a>`
    : escapeHtml(i.sentence)
}

export async function composeDailyCheese(): Promise<{ subject: string; text: string; html: string }> {
  const today = laMidnight(0)
  // Earlier editions, to announce each change once and to say what is new since the last.
  const earlier = await db.sentEmail.findMany({
    where: { sentBy: 'daily-cheese cron', createdAt: { lt: today } },
    orderBy: { createdAt: 'desc' }, take: 30, select: { body: true, createdAt: true },
  })
  const { WHATS_NEW, unannounced } = await import('@/lib/whats-new')
  const sinceLast = earlier[0]?.createdAt ?? new Date(Date.now() - 3 * DAY)
  const arrived = await import('@/lib/shopify-catchup').then((m) => m.arrivedFromShopify(sinceLast)).catch(() => [] as string[])
  const news = newLines(unannounced(WHATS_NEW, earlier.map((e) => e.body)), arrived)
  const items = await buildDailyCheeseItems()
  // Who ordered since the last Cheese and is notable, a repeat buyer or a big
  // one (Brandon, 30 Sept 2026). Fixed sentences, like everything here. A
  // failure leaves the section out rather than the whole email.
  const customers = await import('@/lib/customers').then((m) => m.customerNews()).catch(() => [] as string[])
  // quoteOfTheDay does its own LA-timezone conversion from a real "now"
  // timestamp — `today` here is already pre-shifted to UTC-midnight-of-the-
  // LA-day (see lib/dates.ts), so passing it through would convert twice and
  // land on yesterday's quote. Let it read the actual clock itself.
  const quote = quoteOfTheDay()
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(today).replace(' ', ', ')

  const subject = `The Daily Cheese — ${dateLabel}`

  const text = [
    `The Daily Cheese — ${dateLabel}`,
    '',
    `"${quote.text}" — ${quote.who}`,
    '',
    ...(news.length ? ['New:', ...news.map((n) => `- ${n.text}${n.href ? `\n  ${n.href}` : ''}`), ''] : []),
    // Customers first, above everything else. Brandon, 5 Oct 2026: "put the
    // customers alert at top of daily cheese from now on."
    ...(customers.length ? ['Customers:', ...customers.map((c) => `- ${c}`), ''] : []),
    items.length ? 'Needs attention today:' : '',
    ...items.map((i) => `- ${i.sentence} [${i.tag}]${i.href ? `\n  ${i.href}` : ''}`),
    items.length ? '' : 'Nothing needs attention today.',
    '',
    'That is everything that needs attention today.',
    '— Studio Mouse',
  ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')

  const rows = items.length
    // A table, not flexbox. Gmail and Outlook drop `display:flex` and `gap`
    // outright, so the row collapsed back to ordinary inline flow and the tag
    // ended up jammed against the full stop of the sentence it labels —
    // Brandon, 21 Sept 2026: "the overdue stamps are crowding the text a bit."
    // It looked right everywhere it was written and wrong everywhere it was
    // read. Cell padding is the one spacing that survives every client, so the
    // gap is carried there rather than by anything flex owns.
    ? items.map((i) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border-collapse:separate;border-radius:10px;background:#FBECE9;
                      border:1px solid #EFC8C0;margin-top:8px;">
          <tr>
            <td style="padding:12px 4px 12px 14px;color:#3A342A;font-size:13.5px;line-height:1.5;">${sentenceHtml(i)}</td>
            <td align="right" valign="top" style="padding:12px 14px 12px 16px;white-space:nowrap;">
              <span style="display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.05em;color:#fff;
                           background:#AE3527;padding:3px 8px;border-radius:5px;white-space:nowrap;">${escapeHtml(i.tag)}</span>
            </td>
          </tr>
        </table>`).join('')
    : `<div style="color:#726B5E;font-size:14px;padding:8px 2px;">Nothing needs attention today.</div>`

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body{margin:0;background:#F1EDE3;color:#1C1B19;font-family:Arial,Helvetica,sans-serif;padding:24px 12px;}
  .card{max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2DCCC;border-radius:14px;overflow:hidden;}
  .body{padding:26px 24px 24px;}
  .mark{text-align:center;margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid #EDE8DB;}
  .mark .name{font-weight:700;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#3A342A;}
  .mark .quote{font-style:italic;font-size:14.5px;line-height:1.5;color:#726B5E;margin-top:10px;}
  .mark .quote cite{display:block;font-style:normal;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#8F887A;margin-top:6px;}
  .eyebrow{font-size:11.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#726B5E;margin-bottom:4px;}
  .signoff{margin-top:24px;padding-top:18px;border-top:1px solid #EDE8DB;font-size:13.5px;color:#3A342A;}
  .signoff .sig{display:block;margin-top:10px;font-weight:700;color:#1C1B19;}
</style></head>
<body>
  <div class="card"><div class="body">
    <div class="mark">
      <img src="https://admin.cleocamp.com/mouse/studio-mouse-email.jpg" width="132" height="176" alt="Studio Mouse"
           style="display:block;margin:0 auto 14px;border-radius:12px;border:0;">
      <div class="name">The Daily Cheese</div>
      <div class="quote">&ldquo;${escapeHtml(quote.text)}&rdquo;<cite>${escapeHtml(quote.who)}</cite></div>
    </div>
    ${news.length ? `<div class="eyebrow">New</div>${news.map((n) => `
        <div style="border-radius:10px;background:#EAF1EC;border:1px solid #C9DCCF;margin-top:8px;padding:12px 14px;color:#2F4A39;font-size:13.5px;line-height:1.5;">${n.href ? `<a href="${escapeHtml(n.href).replace(/"/g, '&quot;')}" style="color:#2F4A39;text-decoration:underline;">${escapeHtml(n.text)}</a>` : escapeHtml(n.text)}</div>`).join('')}<div style="height:20px;"></div>` : ''}
    ${customers.length ? `<div class="eyebrow">Customers</div>${customers.map((c) => `
        <div style="border-radius:10px;background:#F4F1EA;border:1px solid #E2DCCC;margin-top:8px;padding:12px 14px;color:#3A342A;font-size:13.5px;line-height:1.5;">${escapeHtml(c)}</div>`).join('')}` : ''}
    <div class="eyebrow"${customers.length ? ' style="margin-top:22px;"' : ''}>${items.length ? 'Needs attention today' : 'All clear'}</div>
    ${rows}
    <div class="signoff">
      That is everything that needs attention today.
      <span class="sig">— Studio Mouse</span>
    </div>
  </div></div>
</body></html>`

  return { subject, text, html }
}
