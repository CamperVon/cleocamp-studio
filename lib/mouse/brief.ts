import { inventoryWritesEnabled } from './tools'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { poLineLabel } from '@/lib/po'
import { laMidnight } from '@/lib/dates'
import { BACKGROUND_MODEL } from '@/lib/mouse/agent'
import { recordUsage, usageOf } from '@/lib/mouse/usage'
import { ratePerDay } from '@/lib/forecast'
import { coverLine } from '@/lib/mouse/brief-cover'

const VOICE = `You are Studio Mouse. You live in a Los Angeles fashion studio. You are
British, you are small, and you have been watching this business closely.

Write the day's note for Cleo. Two or three short paragraphs, blank line
between them. Under 120 words total.

How to write:

Short sentences. Most under fifteen words. Vary them so it does not thud.

Lead with the thing that matters. No throat-clearing, no scene-setting.

Be funny when it is warranted, not on a schedule. One good line beats three
attempts at one. Dry, not zany.

Have an opinion. "Chase RichLine today" is better than "it may be worth
following up with RichLine."

Banned: em dashes. The words "worth noting", "that said", "meanwhile",
"landscape", "navigate", "leverage". Sentences that explain what you just said.
Ending on a neat summary. Sign-offs.

Never invent a number. If something is unknown, say so plainly. The cover
figures (what is left once a delivery lands) are worked out for you: use them
as given, and do not say you cannot tell whether an order covers a shortfall
when a cover line answers it. Not knowing is
often the most useful thing you can point at.

Only what she needs to know today. If the night's notes ran long — a lot of
mail, several things raised — that is not a reason to write a long brief. It
is a reason to work harder at compressing it. Skip anything already resolved,
anything that does not change what she should do today, and anything that is
merely detail behind a point you have already made. One good fact beats three
supporting ones.

British spelling. Plain prose, no markdown, no lists, no bold, no headers.`

/**
 * The single place Mouse's Corner text is ever produced. `overnight` is
 * nightlyPass's own working notes — its record of what it read and what it
 * raised, useful as a log but never as the brief itself, since nothing bounds
 * its length or tone the way VOICE does. It is DISTILLED here, not repeated.
 *
 * Brandon, 10 Sept: the brief had gone long, listy and toneless on a busy
 * night. It had — but not because VOICE stopped working: the nightly cron
 * was writing nightlyPass's raw output straight into DailyBrief and this
 * function, VOICE and all, never ran on any day the cron already had. A
 * working prompt sitting unused is the same failure as a broken one.
 */
export async function composeDailyBrief(overnight?: string): Promise<{ text: string; model: string }> {
  const forDate = laMidnight(0)

  // Compose from the night's notes when we have them — the ones passed in, or
  // failing that the ones kept from whenever today's brief was first written.
  //
  // Only the cron is ever handed them, and it used to hold the only copy. So
  // rewriting the brief later in the day composed it from open items alone and
  // silently dropped whatever the night's mail had surfaced: a shorter, calmer,
  // plausible-looking brief missing the very things the night had found. That
  // is the failure this project keeps meeting (CLAUDE.md §6) and it would have
  // arrived the first time anyone asked Mouse to refresh Corner.
  const stored = overnight
    ? null
    : await db.dailyBrief.findUnique({ where: { forDate }, select: { overnight: true } })
  const notes = overnight ?? stored?.overnight ?? undefined
  const [lowStock, items, pos, sales7, sales1] = await Promise.all([
    db.productVariant.findMany({
      where: { onHandQty: { not: null } },
      orderBy: { onHandQty: 'asc' },
      take: 8,
      include: { product: true, colorway: true },
    }),
    db.actionItem.findMany({ where: { resolved: false }, take: 30, orderBy: { createdAt: 'asc' } }),
    db.purchaseOrder.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } },
      include: { vendor: true, lines: { orderBy: { id: 'asc' }, include: { component: true, productVariant: { include: { product: true, colorway: true } } } } },
    }),
    db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laMidnight(7) } } }),
    // Yesterday only — bounded on both ends, same fix as app/(main)/page.tsx.
    // Missing the upper bound here meant "Sold yesterday" in Mouse's Corner
    // silently included today's partial sync too, overstating the figure.
    db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laMidnight(1), lt: laMidnight(0) } } }),
  ])

  // Cover for everything oversold plus the lowest few: stock now, sales a day
  // (the forecast's own measure), what is due on open POs and when, and what
  // is left once it lands. Worked out here so the brief never has to say it
  // cannot tell (brief-cover.ts).
  const oversold = await db.productVariant.findMany({
    where: { onHandQty: { lt: 0 } },
    orderBy: { onHandQty: 'asc' },
    take: 12,
    include: { product: true, colorway: true },
  })
  const watch = [...new Map([...oversold, ...lowStock].map((v) => [v.id, v])).values()]
    .sort((a, b) => Number(a.onHandQty) - Number(b.onHandQty))
    .slice(0, 12)
  const ids = watch.map((v) => v.id)
  const [sold56, openLines] = await Promise.all([
    db.salesSnapshot.findMany({ where: { productVariantId: { in: ids }, date: { gte: laMidnight(56) } }, select: { productVariantId: true, date: true, unitsSold: true } }),
    db.purchaseOrderLine.findMany({
      where: { productVariantId: { in: ids }, purchaseOrder: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } } },
      select: { productVariantId: true, qtyOrdered: true, qtyReceived: true, purchaseOrder: { select: { poNumber: true, expectedAt: true } } },
    }),
  ])
  const cover = watch.map((v) => coverLine({
    label: [v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / '),
    onHand: Number(v.onHandQty),
    perDay: ratePerDay(sold56.filter((s) => s.productVariantId === v.id)),
    incoming: openLines.filter((l) => l.productVariantId === v.id).map((l) => ({
      po: l.purchaseOrder.poNumber, qty: Number(l.qtyOrdered) - Number(l.qtyReceived), due: l.purchaseOrder.expectedAt,
    })),
  }, laMidnight(0)))

  const facts = [
    `Sold yesterday: ${sales1._sum.unitsSold ?? 0} units. Last 7 days: ${sales7._sum.unitsSold ?? 0}.`,
    '',
    'Lowest stock and cover (negative means oversold; worked out by code, use as given):',
    ...cover.map((l) => `- ${l}`),
    '',
    'On order:',
    ...pos.map(
      (p) =>
        `- PO ${p.poNumber} from ${p.vendor.name}: ${p.lines
          .map((l) => `${l.qtyOrdered} ${l.unit} ${poLineLabel(l)}`)
          .join(', ')}${p.expectedAt ? `, due ${p.expectedAt.toISOString().slice(0, 10)}` : ', no date confirmed'}`,
    ),
    '',
    `Open questions and todos (${items.length}):`,
    ...items.slice(0, 14).map((i) => `- ${i.title}`),
    '',
    // Only when it is true. This line used to be written in unconditionally, so
    // long after the first studio count was done the corner kept telling
    // Brandon to treat every number as "directionally true, not exact"
    // (27 Sept 2026: "i don't understand this line").
    inventoryWritesEnabled() ? '' : 'Note: inventory writing is currently paused for a studio count, so counts may be stale.',
    notes ? `\nStudio Mouse's own working notes from tonight — distill the ONE or TWO things from this that actually matter, do not summarise the whole thing:\n${notes}` : '',
  ].filter(Boolean).join('\n')

  const client = new Anthropic()
  const startedAt = Date.now()
  const res = await client.messages.create({
    model: BACKGROUND_MODEL,
    // Thinking counts toward this; the brief's own length is set in VOICE.
    max_tokens: 4000,
    system: VOICE,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: `Here is where things stand today.\n\n${facts}` }],
  })
  await recordUsage('brief', [usageOf(BACKGROUND_MODEL, res.usage, startedAt)])
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

  // Upsert, not create — this runs from the nightly cron every night, and
  // must be able to overwrite today's row rather than fail the second time
  // it is asked to produce one.
  await db.dailyBrief.upsert({
    where: { forDate },
    create: { forDate, text, model: BACKGROUND_MODEL, overnight: notes ?? null },
    // Never blank stored notes on a rewrite that was not given any: a refresh
    // composed FROM them must not then delete them and leave the next refresh
    // poorer than this one.
    update: { text, model: BACKGROUND_MODEL, ...(notes ? { overnight: notes } : {}) },
  })
  return { text, model: BACKGROUND_MODEL }
}

/**
 * Read today's brief, generating a plain one (no overnight notes to work
 * from) only if the cron has not already produced one. In normal operation
 * the cron always wins this race — it runs hours before anyone opens Home —
 * so this is the fallback for a day the cron did not run, not the main path.
 */
export async function getDailyBrief(): Promise<{ text: string; fresh: boolean } | null> {
  const forDate = laMidnight(0)
  const existing = await db.dailyBrief.findUnique({ where: { forDate } })
  if (existing) return { text: existing.text, fresh: false }
  if (!process.env.ANTHROPIC_API_KEY) return null
  const { text } = await composeDailyBrief()
  return { text, fresh: true }
}
