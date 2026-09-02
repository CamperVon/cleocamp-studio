import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'
import { recomputeForecasts } from '@/lib/forecast'
import { processInbox } from '@/lib/mouse/inbox'
import { getDailyBrief } from '@/lib/mouse/brief'
import { sendEmail } from '@/lib/email'
import { fetchFeed } from '@/lib/integrations/calendar'
import { isConfigured } from '@/lib/integrations/shopify'

export const maxDuration = 300

/**
 * One job a day that fans out.
 *
 * Vercel Hobby allows a single daily cron, so rather than three schedules this
 * runs once and decides what to send: the digest every day, the weekly on a
 * Monday, the monthly on the first. It also keeps the three cadences consistent
 * with each other by construction — they are all reading the same numbers from
 * the same moment.
 *
 * Guarded by CRON_SECRET, not a session, because Vercel Cron cannot hold a
 * cookie. Safe to run repeatedly: alerts dedupe on a unique index and digests
 * are keyed by date.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ?dry=1 runs everything and composes the digests but sends nothing. Testing
  // the real route should never put mail in the team's inbox.
  const dryRun = req.nextUrl.searchParams.get('dry') === '1'

  const log: Record<string, unknown> = { dryRun }
  const step = async (name: string, fn: () => Promise<unknown>) => {
    // One failing step must not take the whole night with it.
    try { log[name] = await fn() } catch (e) { log[name] = { error: (e as Error).message } }
  }

  // ── 1. Pull in the world ─────────────────────────────────
  await step('calendar', async () => {
    const events = await fetchFeed()
    for (const e of events) {
      const existing = await db.calendarEvent.findFirst({ where: { googleEventId: e.uid } })
      const data = {
        googleEventId: e.uid, title: e.title, date: e.start,
        type: 'OTHER' as const, source: 'GOOGLE' as const,
        notes: [e.location, e.notes].filter(Boolean).join(' — ') || null,
      }
      if (existing) await db.calendarEvent.update({ where: { id: existing.id }, data })
      else await db.calendarEvent.create({ data })
    }
    return { synced: events.length }
  })

  await step('inbox', () => processInbox())

  // ── 2. Work out where things stand ───────────────────────
  await step('forecast', async () => {
    const results = await recomputeForecasts()
    return { computed: results.length, blocked: results.filter((r) => r.blocked).length }
  })

  // ── 3. Raise what needs raising ──────────────────────────
  await step('alerts', async () => {
    const soon = new Date(Date.now() + 7 * 864e5)
    const forecasts = await db.forecastResult.findMany({
      include: { product: true, component: true },
    })
    let raised = 0

    const raise = async (key: string, severity: 'WARNING' | 'URGENT', message: string) => {
      // The partial unique index makes this idempotent: one unresolved alert
      // per condition, however many times the job runs.
      try {
        await db.alert.create({ data: { dedupeKey: key, severity, message } })
        raised++
      } catch { /* already open */ }
    }

    for (const f of forecasts) {
      const name = f.product?.name ?? f.component?.name ?? 'something'
      if (f.blockedReason) {
        await raise(`blocked:${f.productId ?? f.componentId}`, 'WARNING',
          `Can't forecast ${name} — ${f.blockedReason}`)
      } else if (f.recommendedOrderDate && f.recommendedOrderDate <= soon) {
        await raise(`order:${f.productId ?? f.componentId}`, 'URGENT',
          `Order ${name} by ${f.recommendedOrderDate.toISOString().slice(0, 10)}. ${f.note ?? ''}`.trim())
      }
    }

    // Negative stock means something was sold that does not exist. Never let
    // that sit as a quietly displayed minus sign.
    const negativeVariants = await db.productVariant.findMany({
      where: { onHandQty: { lt: 0 } },
      include: { product: true, colorway: true },
    })
    for (const v of negativeVariants) {
      const label = [v.product.name, v.colorway?.customerName, v.size].filter(Boolean).join(' / ')
      await raise(`negative:${v.id}`, 'URGENT', `${label} is at ${v.onHandQty} — oversold.`)
    }
    return { raised }
  })

  // ── 4. Calendar entries for the dates that matter ────────
  await step('calendarEvents', async () => {
    const due = await db.forecastResult.findMany({
      where: { recommendedOrderDate: { not: null } },
      include: { product: true, component: true },
    })
    let made = 0
    for (const f of due) {
      const name = f.product?.name ?? f.component?.name ?? 'something'
      const title = `Order ${name}`
      const existing = await db.calendarEvent.findFirst({
        where: { title, date: f.recommendedOrderDate!, source: 'STUDIO_MOUSE' },
      })
      if (existing) continue
      await db.calendarEvent.create({
        data: {
          forecastResultId: f.id, title, date: f.recommendedOrderDate!,
          type: 'ORDER_BY', source: 'STUDIO_MOUSE', notes: f.note,
        },
      })
      made++
    }
    return { made }
  })

  // ── 5. Write the day's note before anyone is awake ───────
  await step('brief', async () => {
    const b = await getDailyBrief()
    return { written: b?.fresh ?? false }
  })

  // ── 6. Send what is due today ────────────────────────────
  await step('digests', async () => {
    // laMidnight already carries the Pacific calendar date, so day-of-week and
    // day-of-month come straight off it. Asking Intl for a numeric weekday is
    // not a thing it does.
    const laToday = laMidnight(0)
    const laDow = laToday.getUTCDay() // 0 = Sunday
    const laDom = laToday.getUTCDate()

    const kinds: Array<'DAILY' | 'WEEKLY' | 'MONTHLY'> = ['DAILY']
    if (laDow === 1) kinds.push('WEEKLY')
    if (laDom === 1) kinds.push('MONTHLY')

    const sent: string[] = []
    for (const kind of kinds) {
      const forDate = laMidnight(0)
      const already = await db.digestSend.findUnique({
        where: { kind_sentForDate: { kind, sentForDate: forDate } },
      })
      if (already) continue

      const text = await composeDigest(kind)
      if (!text) continue
      if (dryRun) { sent.push(`${kind} (composed, not sent)`); continue }
      const subject =
        kind === 'DAILY' ? 'Studio Mouse — today'
        : kind === 'WEEKLY' ? 'Studio Mouse — the week'
        : 'Studio Mouse — the month'
      const res = await sendEmail({ subject, text })
      if (res.sent) {
        // Recorded only on a successful send, so a failure retries tomorrow
        // rather than being marked done.
        await db.digestSend.create({
          data: { kind, sentForDate: forDate, recipients: process.env.DIGEST_RECIPIENTS ?? '', subject },
        })
        sent.push(kind)
      }
    }
    return { sent }
  })

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...log })
}

const DIGEST_VOICE = `You are Studio Mouse, writing an email to the Cleo Camp team.

British, dry, fond of them, unimpressed by suppliers who do not confirm dates.

Narrate it. Do not dump a table. "Pink Cleo Tee should sell out in about four
weeks. Buttons take two weeks, so order by Wednesday" is the register.

Short paragraphs, blank line between. Lead with whatever actually matters.
No markdown, no bullet lists, no headings, no sign-off. Never invent a number.
If something is unknown, say so — not knowing is often the point.`

async function composeDigest(kind: 'DAILY' | 'WEEKLY' | 'MONTHLY'): Promise<string | null> {
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
