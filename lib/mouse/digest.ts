import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'

const DIGEST_VOICE = `You are Studio Mouse, writing an email to the Cleo Camp team.

British, dry, fond of them, unimpressed by suppliers who do not confirm dates.

Narrate it. Do not dump a table. "Pink Cleo Tee should sell out in about four
weeks. Buttons take two weeks, so order by Wednesday" is the register.

Short paragraphs, blank line between. Lead with whatever actually matters.
No markdown, no bullet lists, no headings, no sign-off. Never invent a number.
If something is unknown, say so — not knowing is often the point.`

export async function composeDigest(kind: 'DAILY' | 'WEEKLY' | 'MONTHLY'): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const days = kind === 'DAILY' ? 1 : kind === 'WEEKLY' ? 7 : 30

  const [forecasts, alerts, items, sales, pos] = await Promise.all([
    db.forecastResult.findMany({ include: { product: true, component: true } }),
    db.alert.findMany({ where: { resolved: false } }),
    db.actionItem.findMany({ where: { resolved: false }, take: 25, orderBy: { createdAt: 'asc' } }),
    db.salesSnapshot.aggregate({ _sum: { unitsSold: true }, where: { date: { gte: laMidnight(days) } } }),
    db.purchaseOrder.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } },
      include: { vendor: true, lines: { include: { component: true } } },
    }),
  ])

  const facts = [
    `Period: last ${days} day${days > 1 ? 's' : ''}. Units sold: ${sales._sum.unitsSold ?? 0}.`,
    '',
    'Forecasts:',
    ...forecasts.map((f) =>
      `- ${f.product?.name ?? f.component?.name}: ${f.blockedReason ? 'BLOCKED — ' + f.blockedReason : f.note}` +
      (f.recommendedOrderDate ? ` Order by ${f.recommendedOrderDate.toISOString().slice(0, 10)}.` : '')),
    '',
    `Open alerts (${alerts.length}):`,
    ...alerts.map((a) => `- ${a.severity}: ${a.message}`),
    '',
    'On order:',
    ...pos.map((p) => `- PO ${p.poNumber} from ${p.vendor.name}: ${p.lines.map((l) => `${l.qtyOrdered} ${l.unit} ${l.component.name}`).join(', ')}${p.expectedAt ? `, due ${p.expectedAt.toISOString().slice(0, 10)}` : ', no date confirmed'}`),
    '',
    `Waiting on answers (${items.length}):`,
    ...items.map((i) => `- ${i.title}`),
  ].join('\n')

  const res = await new Anthropic().messages.create({
    model: 'claude-opus-5',
    max_tokens: 3000,
    system: DIGEST_VOICE,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: `Write the ${kind.toLowerCase()} note.\n\n${facts}` }],
  })
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()
}
