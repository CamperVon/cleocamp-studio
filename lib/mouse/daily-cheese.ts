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
 *
 * Deliberately NOT an LLM composition, unlike composeAmReport/composeDigest.
 * Cleo's own words: "no opus overwriting or explaining or exaggerations."
 * Every red thing here already has a mechanical reason (a date passed, a
 * date is close, someone said "urgent") — templating it keeps that reason
 * the whole sentence, instead of leaving prose free to invent tone that
 * was never asked for.
 */

const DAY = 864e5

type Item = { on: Date; tag: string; sentence: string }

function tag(on: Date, today: Date): string {
  if (on < today) return 'OVERDUE'
  const days = Math.round((on.getTime() - today.getTime()) / DAY)
  if (days === 0) return 'TODAY'
  if (days === 1) return 'TOMORROW'
  return on.toISOString().slice(0, 10).toUpperCase()
}

function duePhrase(on: Date, today: Date): string {
  if (on < today) return 'It is overdue.'
  const days = Math.round((on.getTime() - today.getTime()) / DAY)
  if (days === 0) return 'It is due today.'
  if (days === 1) return 'It is due tomorrow.'
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
    const overdue = !!po.expectedAt && po.expectedAt < today && po.status !== 'PARTIALLY_RECEIVED'
    const dueSoon = !!po.expectedAt && po.expectedAt >= today && po.expectedAt <= cutoff
    const isDraft = po.status === 'DRAFT'
    if (!overdue && !dueSoon && !isDraft) continue

    for (const l of po.lines) if (l.productVariant) coveredProductIds.add(l.productVariant.product.id)

    const products = [...new Set(po.lines.map((l) => l.productVariant?.product.name).filter(Boolean))] as string[]
    const what = products.length ? products.join(', ') : 'this order'
    const on = po.expectedAt ?? po.orderedAt ?? today

    const sentence = isDraft
      ? `PO ${po.poNumber} (${po.vendor.name}, ${what}) is still a draft. Send it or say why not.`
      : overdue
        ? `PO ${po.poNumber} (${po.vendor.name}, ${what}) is overdue. Confirm when it will ship.`
        : `PO ${po.poNumber} (${po.vendor.name}, ${what}). ${duePhrase(on, today)} Confirm it is on track.`

    out.push({ on, tag: isDraft ? 'DRAFT' : tag(on, today), sentence })
  }

  // ── Runs at a maker ───────────────────────────────────────
  // Skip a run whose product is already covered by a red order above — a
  // run finishing and its cut-and-sew PO coming due are usually the same
  // shipment told twice, which is exactly the laundry-list problem the
  // three Cleo Bag colourways surfaced in the mockup.
  for (const r of runs) {
    if (!r.expectedReadyAt || coveredProductIds.has(r.productId)) continue
    const late = r.expectedReadyAt < today
    const dueSoon = r.expectedReadyAt >= today && r.expectedReadyAt <= cutoff
    if (!late && !dueSoon) continue
    const vendor = r.vendor?.name ?? 'the maker'
    const sentence = late
      ? `${r.product.name} at ${vendor} is overdue. Confirm when it will be ready.`
      : `${r.product.name} at ${vendor}. ${duePhrase(r.expectedReadyAt, today)} Confirm it is ready.`
    out.push({ on: r.expectedReadyAt, tag: tag(r.expectedReadyAt, today), sentence })
  }

  // ── Calendar — only when Jane is actually named ────────────
  // Cleo, 17 Sept: "don't pick up things from the calendar unless Jane is
  // specifically mentioned. Jane is not on that call." A calendar entry is
  // free text written for no one in particular; most of it isn't hers.
  for (const e of events) {
    const mentionsJane = /\bjane\b/i.test(e.title) || (!!e.notes && /\bjane\b/i.test(e.notes))
    if (!mentionsJane) continue
    const sentence = `${period(e.title)} ${duePhrase(e.date, today)}`
    out.push({ on: e.date, tag: tag(e.date, today), sentence })
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
    const overdue = !!i.dueDate && i.dueDate < today
    const window = laMidnight(-(i.remindDaysBefore ?? URGENT_WINDOW_DAYS))
    const dueSoon = !!i.dueDate && i.dueDate >= today && i.dueDate <= window
    const urgentNoDate = i.urgent && !i.dueDate
    if (!overdue && !dueSoon && !urgentNoDate) continue
    const on = urgentNoDate ? today : (i.dueDate ?? i.createdAt)
    const sentence = overdue
      ? `${period(i.title)} It is overdue.`
      : urgentNoDate
        ? `${period(i.title)} This is urgent.`
        : `${period(i.title)} ${duePhrase(i.dueDate!, today)}`
    out.push({ on, tag: urgentNoDate ? 'URGENT' : tag(on, today), sentence })
  }

  out.sort((a, b) => a.on.getTime() - b.on.getTime())
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function composeDailyCheese(): Promise<{ subject: string; text: string; html: string }> {
  const today = laMidnight(0)
  const items = await buildDailyCheeseItems()
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
    items.length ? 'Needs attention today:' : '',
    ...items.map((i) => `- ${i.sentence} [${i.tag}]`),
    items.length ? '' : 'Nothing needs attention today.',
    '',
    'That is everything that needs attention today.',
    '— Studio Mouse',
  ].filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n')

  const rows = items.length
    ? items.map((i) => `
        <div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between;
                    padding:12px 14px;border-radius:10px;background:#FBECE9;border:1px solid #EFC8C0;margin-top:8px;">
          <div style="color:#3A342A;font-size:13.5px;line-height:1.5;">${escapeHtml(i.sentence)}</div>
          <span style="flex-shrink:0;font-size:10.5px;font-weight:700;letter-spacing:.05em;color:#fff;
                       background:#AE3527;padding:3px 8px;border-radius:5px;white-space:nowrap;">${escapeHtml(i.tag)}</span>
        </div>`).join('')
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
      <div class="name">The Daily Cheese</div>
      <div class="quote">&ldquo;${escapeHtml(quote.text)}&rdquo;<cite>${escapeHtml(quote.who)}</cite></div>
    </div>
    <div class="eyebrow">${items.length ? 'Needs attention today' : 'All clear'}</div>
    ${rows}
    <div class="signoff">
      That is everything that needs attention today.
      <span class="sig">— Studio Mouse</span>
    </div>
  </div></div>
</body></html>`

  return { subject, text, html }
}
