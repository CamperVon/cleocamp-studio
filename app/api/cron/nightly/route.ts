import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'
import { refreshForecastsAndAlerts } from '@/lib/forecast'
import { processInbox } from '@/lib/mouse/inbox'
import { nightlyPass } from '@/lib/mouse/nightly-pass'
import { whoSaidWhat, renderWhoSaidWhat } from '@/lib/mouse/who-said-what'
import { sendEmail } from '@/lib/email'
import { fetchFeed } from '@/lib/integrations/calendar'
import { composeDigest } from '@/lib/mouse/digest'
import { snapshotPosition, isConfigured as qboConfigured } from '@/lib/integrations/quickbooks'
import { isConfigured as shopifyConfigured } from '@/lib/integrations/shopify'
import { syncShopify } from '@/lib/integrations/shopify-sync'
import { cleanupStorage } from '@/lib/mouse/storage-cleanup'

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
    // Two subscribed feeds, kept apart by type. The studio calendar is
    // whatever is on Cleo's day; the logistics feed is goods physically
    // moving — "Rolando Dress Pickup", "Staples size tag drop off" — which
    // is a different question and worth Mouse being able to tell apart.
    // A missing logistics URL is skipped, not an error: the studio feed must
    // keep syncing whether or not the second one is configured yet.
    const feeds: Array<{ url: string | undefined; type: 'OTHER' | 'DELIVERY_EXPECTED'; label: string }> = [
      { url: process.env.CALENDAR_FEED_URL, type: 'OTHER', label: 'studio' },
      { url: process.env.LOGISTICS_FEED_URL, type: 'DELIVERY_EXPECTED', label: 'logistics' },
    ]

    const counts: Record<string, number | string> = {}
    for (const feed of feeds) {
      if (!feed.url) {
        counts[feed.label] = 'not configured'
        continue
      }
      const events = await fetchFeed(feed.url)
      for (const e of events) {
        const existing = await db.calendarEvent.findFirst({ where: { googleEventId: e.uid } })
        const data = {
          googleEventId: e.uid, title: e.title, date: e.start,
          type: feed.type, source: 'GOOGLE' as const,
          notes: [e.location, e.notes].filter(Boolean).join(' — ') || null,
        }
        if (existing) await db.calendarEvent.update({ where: { id: existing.id }, data })
        else await db.calendarEvent.create({ data })
      }
      counts[feed.label] = events.length
    }
    return counts
  })

  // Shopify is the master for finished goods, so the forecast below is only
  // as current as this. A trailing window, not the full order history —
  // that would keep growing and this needs to stay well inside the Hobby
  // cron's 300s ceiling. A day with no rows here reads as unknown downstream,
  // never as zero sold — a gap is not the same fact as a quiet day.
  await step('shopify', async () => {
    if (!shopifyConfigured()) return { skipped: 'not connected' }
    const since = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10)
    const r = await syncShopify(db, since)
    return {
      variantsUpdated: r.variantsUpdated, variantsUnknown: r.variantsUnknown.length,
      salesWritten: r.salesWritten, unitsSold: r.unitsSold,
      onHand: `${r.onHandCounted}/${r.onHandTotal}`,
    }
  })

  // First the structured intake — the routine's balances email is data, not
  // correspondence, and should not be reasoned about.
  await step('balances', () => processInbox())

  // Then one pass over everything else, with the same brain the chat uses.
  await step('think', async () => {
    const r = await nightlyPass()
    // r.summary is the working pass's own notes — what it read, what it
    // raised. Useful as a log, but nothing bounds its length or tone, so it
    // is fed to composeDailyBrief() to be DISTILLED under Mouse's actual
    // voice, never written into DailyBrief verbatim. See lib/mouse/brief.ts.
    if (r.summary) {
      const { composeDailyBrief } = await import('@/lib/mouse/brief')
      await composeDailyBrief(r.summary)
    }
    return { read: r.read, raised: r.raised, model: r.model }
  })

  // Also keeps the Intuit connection alive. Refresh tokens die after 100 days
  // unused, so this runs whether or not anyone asked for the figures.
  await step('quickbooks', async () => {
    // Paused until the books are reconciled. Skipping quietly rather than
    // failing every night — an error log that is always there gets ignored,
    // and then a real one gets ignored with it.
    if (!qboConfigured()) return { skipped: 'not connected' }
    const p = await snapshotPosition()
    return { asOf: p.asOf, cash: Number(p.cashCents) / 100, ar: Number(p.arCents) / 100 }
  })

  // ── 3. Raise what needs raising ──────────────────────────
  // Shared with the chat route (lib/mouse/agent.ts), which calls the same
  // function mid-day after a write that could move a forecast, so this is
  // now the nightly catch-all rather than the only time it ever runs.
  await step('alerts', () => refreshForecastsAndAlerts())

  // Cash used to be nagged about here: a nightly check that raised
  // "cash figures are N days old" whenever the last snapshot aged past a week.
  // That alert could never be satisfied. Cleo dropped cash from the Finances
  // page on 12 Sept — QuickBooks exposes no live bank balance to any API, and
  // the manual workflow is one she does not run — so the page is P&L only and
  // nothing refreshes that snapshot. The job was warning, every single night,
  // that a number nobody maintains had not been maintained.
  // Removed 16 Sept 2026 at Cleo's request. Any still-open ones are closed.
  await step('financeAlertCleanup', async () => {
    const r = await db.alert.updateMany({
      where: { resolved: false, dedupeKey: { in: ['finance:stale', 'finance:none'] } },
      data: { resolved: true, resolvedAt: new Date() },
    })
    return { closed: r.count }
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

  // ── 6. Send what is due today ────────────────────────────
  // Every switch below is a row in NotificationSettings, not a constant —
  // "stop emailing me" is a thing a person says, and it should never need a
  // deploy. Mouse can flip any of them with update_notification_settings.
  const notify = await db.notificationSettings.findUnique({ where: { id: 'singleton' } })

  await step('digests', async () => {
    if (!notify?.digestEnabled) return { skipped: 'digest switched off' }

    // laMidnight already carries the Pacific calendar date, so day-of-week and
    // day-of-month come straight off it. Asking Intl for a numeric weekday is
    // not a thing it does.
    const laToday = laMidnight(0)
    const laDow = laToday.getUTCDay() // 0 = Sunday
    const laDom = laToday.getUTCDate()

    const kinds: Array<'DAILY' | 'WEEKLY' | 'MONTHLY'> = ['DAILY']
    if (laDow === 1) kinds.push('WEEKLY')
    if (laDom === 1) kinds.push('MONTHLY')

    // A digest that silently never sends because a recipient list is blank is
    // exactly the failure nobody notices for a fortnight.
    const recipients = (process.env.DIGEST_RECIPIENTS ?? '').split(',').map((r) => r.trim()).filter(Boolean)
    if (!recipients.length) {
      return { error: 'DIGEST_RECIPIENTS is empty — nothing was sent to anyone.' }
    }

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

  // ── 6b. What everyone else told Mouse ────────────────────
  // Brandon, 21 Sept 2026, once other people could reach Mouse from their own
  // phones: "could it email me everything other users posted, so I'm aware."
  // Updates from four phones otherwise land correctly in the record and
  // nobody mentions they happened.
  await step('toldToMouse', async () => {
    const recipients = (process.env.DIGEST_RECIPIENTS ?? '').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)
    if (!recipients.length) return { skipped: 'no recipients configured' }

    // "Other users" means other than whoever is reading it. Anyone on the
    // recipient list already knows what they themselves said.
    const readers = await db.person.findMany({
      where: { email: { not: null } },
      select: { name: true, email: true, aliasEmails: true },
    })
    const excludeNames = readers
      .filter((p) => {
        const addresses = [p.email, ...(p.aliasEmails ?? '').split(',')]
          .map((a) => (a ?? '').trim().toLowerCase())
          .filter(Boolean)
        return addresses.some((a) => recipients.includes(a))
      })
      .map((p) => p.name)

    const items = await whoSaidWhat(excludeNames)
    // Nobody said anything is not news. An empty email every morning is how a
    // real one stops being opened.
    if (!items.length) return { nothing: 'no updates from anyone else' }

    const { subject, text, html } = renderWhoSaidWhat(items)

    // The cron fires once a day on Hobby, but a manual re-run should not send
    // this twice. SentEmail is the record of what actually went out.
    const already = await db.sentEmail.findFirst({
      where: { subject, createdAt: { gte: laMidnight(0) } },
      select: { id: true },
    })
    if (already) return { skipped: 'already sent today' }

    if (dryRun) return { composed: items.length, subject, sent: false }
    const res = await sendEmail({ subject, text, html })
    return { sent: res.sent, updates: items.length, from: [...new Set(items.map((i) => i.person))] }
  })

  // ── 7. Chip away at the open-questions list ──────────────
  // Brandon, 3 Sept 2026: two questions a day from "Things to tend to" for
  // two weeks, explained nicely, because the list is long and Cleo is busy.
  // Mouse itself has no clock — this cron is that clock. Delete this block
  // (and the migration that added askedViaEmailAt, if unwanted elsewhere)
  // once the two weeks are up or the list runs dry, whichever is first.
  await step('chipAway', async () => {
    if (!notify?.chipAwayEnabled) return { skipped: 'chip-away switched off' }

    // Same representation laMidnight uses — UTC midnight standing in for the
    // LA calendar date — so subtracting it from `today` below is comparing
    // like with like. A wall-clock offset here (-07:00) would have been off
    // by that many hours against laMidnight and misfired near the boundary.
    const START = new Date(Date.UTC(2026, 8, 3)) // 3 Sept 2026, LA date
    const DAYS = 14
    const PER_DAY = 2

    const today = laMidnight(0)
    const dayIndex = Math.floor((today.getTime() - START.getTime()) / 864e5)
    if (dayIndex < 0 || dayIndex >= DAYS) return { skipped: 'outside the two-week window' }

    // Reruns of the same cron day (a retry, a manual poke) must not send twice.
    const sentToday = await db.actionItem.count({ where: { askedViaEmailAt: { gte: today } } })
    if (sentToday > 0) return { skipped: "already sent today's pair" }

    const openWhere = { resolved: false, kind: 'QUESTION' as const, askedViaEmailAt: null }
    const next = await db.actionItem.findMany({
      where: openWhere,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: PER_DAY,
    })
    if (!next.length) return { skipped: 'nothing left on the list' }
    const remainingAfter = (await db.actionItem.count({ where: openWhere })) - next.length

    const body = [
      "Chipping away at the open-questions list, a couple a day rather than dumping " +
        'the whole thing on you at once. Whenever you get a moment:',
      ...next.map((q, i) => `${i + 1}) ${q.title}${q.detail ? `\n${q.detail}` : ''}`),
      remainingAfter > 0
        ? `${remainingAfter} left after these — more tomorrow, no rush on any of it.`
        : "That's the last of them for now.",
      '— Studio Mouse',
    ].join('\n\n')

    if (dryRun) return { wouldSend: next.map((q) => q.title), remainingAfter }

    const res = await sendEmail({
      to: ['studio@cleocamp.com'], cc: ['brandon@cleocamp.com'],
      subject: 'A couple of things — Studio Mouse', text: body,
    })
    if (!res.sent) return { error: res.reason }

    const askedAt = new Date()
    await db.actionItem.updateMany({
      where: { id: { in: next.map((q) => q.id) } },
      data: { askedViaEmailAt: askedAt },
    })
    await db.sentEmail.create({
      data: {
        toAddress: 'studio@cleocamp.com', ccAddress: 'brandon@cleocamp.com',
        subject: 'A couple of things — Studio Mouse', body,
        resendId: (res as { id?: string }).id ?? null, sentBy: 'nightly cron (chip away)',
      },
    })
    return { sent: next.map((q) => q.title), remainingAfter }
  })

  // ── 8. Clear old content nobody needs kept ────────────────
  // A cheap no-op most nights — see lib/mouse/storage-cleanup.ts for the
  // ~60-day gate. dryRun previews counts without touching anything, same as
  // every other side-effecting step here.
  await step('storageCleanup', () => cleanupStorage({ dryRun }))

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...log })
}
