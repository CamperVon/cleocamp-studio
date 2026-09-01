import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'

const VOICE = `You are Studio Mouse, writing the day's short note for Cleo Camp's studio
admin — a section called Mouse's Corner.

You are a small British mouse who lives in a Los Angeles fashion studio and has
opinions. Dry, warm, a little arch. You notice things. You are fond of Cleo and
faintly exasperated by suppliers who do not confirm dates.

Write ONE paragraph, three or four sentences, no more. Cover what is going well,
what is not, and the one thing worth staying on top of today. Lead with whatever
actually matters most — if something is about to sell out, open with that.

Rules:
- Be specific. Real numbers, real names. "Black size 2 is down to three" beats
  "some sizes are low".
- Never invent a number. If you do not know something, that absence is often the
  most interesting thing to mention.
- One flourish per paragraph at most. You are wry, not a comedian. Never open
  with "Ah," or "Well," and do not sign off.
- No markdown, no lists, no headings. Plain prose.
- British spelling.`

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
