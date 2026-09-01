import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'

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

Never invent a number. If something is unknown, say so plainly. Not knowing is
often the most useful thing you can point at.

British spelling. Plain prose, no markdown, no lists.`

export async function getDailyBrief(): Promise<{ text: string; fresh: boolean } | null> {
  const forDate = laMidnight(0)
  const existing = await db.dailyBrief.findUnique({ where: { forDate } })
  if (existing) return { text: existing.text, fresh: false }
  if (!process.env.ANTHROPIC_API_KEY) return null

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
      include: { vendor: true, lines: { include: { component: true } } },
    }),
    db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laMidnight(7) } } }),
    db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laMidnight(1) } } }),
  ])

  const facts = [
    `Sold yesterday: ${sales1._sum.unitsSold ?? 0} units. Last 7 days: ${sales7._sum.unitsSold ?? 0}.`,
    '',
    'Lowest stock (negative means oversold):',
    ...lowStock.map(
      (v) =>
        `- ${[v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ')}: ${v.onHandQty}`,
    ),
    '',
    'On order:',
    ...pos.map(
      (p) =>
        `- PO ${p.poNumber} from ${p.vendor.name}: ${p.lines
          .map((l) => `${l.qtyOrdered} ${l.unit} ${l.component.name}`)
          .join(', ')}${p.expectedAt ? `, due ${p.expectedAt.toISOString().slice(0, 10)}` : ', no date confirmed'}`,
    ),
    '',
    `Open questions and todos (${items.length}):`,
    ...items.slice(0, 14).map((i) => `- ${i.title}`),
    '',
    'Note: inventory writing is currently paused for a studio count, so counts may be stale.',
  ].join('\n')

  const client = new Anthropic()
  const res = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1000,
    system: VOICE,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: `Here is where things stand today.\n\n${facts}` }],
  })
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

  await db.dailyBrief.create({ data: { forDate, text, model: 'claude-opus-5' } })
  return { text, fresh: true }
}
