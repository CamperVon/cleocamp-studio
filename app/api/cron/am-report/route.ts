import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { laHour, laMidnight, MORNING_HOUR } from '@/lib/dates'
import { sendEmail } from '@/lib/email'
import { composeAmReport } from '@/lib/mouse/am-report'
import { isConfigured as shopifyConfigured } from '@/lib/integrations/shopify'
import { syncShopify } from '@/lib/integrations/shopify-sync'

export const maxDuration = 300

// Brandon, 3 Sept 2026: an 8am report to him and Cleo — nightly mail, current
// Shopify, and whatever's pressing, "fun and lite and Mouse in tone". Separate
// cron from the nightly job (which runs ~5am and does the heavier lifting —
// forecasting, alerts, the chip-away drip) because Hobby cron jobs only fire
// once a day each and this needs its own, later, hour.
//
// Vercel's Hobby scheduling is per-hour, not per-minute, and in UTC. It runs
// at 15:00 and 16:00 UTC and the run that is 8am or later in LA sends, so the
// clock change never moves it (2 Nov 2026).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dry') === '1'
  // Runs at 15:00 and 16:00 UTC (vercel.json); only the run at 8am or later
  // in LA sends, so it is 8am in summer and winter alike. ?now=1 skips the wait.
  if (laHour() < MORNING_HOUR && req.nextUrl.searchParams.get('now') !== '1') {
    return NextResponse.json({ skipped: `before ${MORNING_HOUR}am in Los Angeles; the next hour's run sends` })
  }

  // This had no off switch at all until 4 Sept 2026 — it simply ran, and
  // asking Studio Mouse to stop it got "I can't switch that off myself."
  // NotificationSettings is that switch; Mouse can flip it on request.
  const notify = await db.notificationSettings.findUnique({ where: { id: 'singleton' } })
  if (!notify?.amReportEnabled) return NextResponse.json({ skipped: 'morning report switched off' })

  // A retry or a manual poke on the same day must not send twice.
  const today = laMidnight(0)
  const already = await db.sentEmail.findFirst({
    where: { sentBy: 'am-report cron', createdAt: { gte: today } },
  })
  if (already) return NextResponse.json({ skipped: 'already sent today' })

  // "Freshly synced" is the point of this email — worth a real pull right
  // before composing rather than trusting whatever the ~5am job left behind,
  // small as that gap usually is. A short window: this only needs to catch
  // anything since the nightly sync, not rebuild history.
  let shopify: unknown = { skipped: 'not connected' }
  if (shopifyConfigured()) {
    const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)
    shopify = await syncShopify(db, since)
  }

  const report = await composeAmReport()
  if (!report) return NextResponse.json({ shopify, error: 'ANTHROPIC_API_KEY not configured' })

  if (dryRun) return NextResponse.json({ shopify, dryRun: true, subject: report.subject, text: report.text })

  const to = ['brandon@cleocamp.com', 'studio@cleocamp.com']
  const res = await sendEmail({ to, subject: report.subject, text: report.text })
  if (!res.sent) return NextResponse.json({ shopify, error: res.reason }, { status: 500 })

  await db.sentEmail.create({
    data: {
      toAddress: to.join(', '), subject: report.subject, body: report.text,
      resendId: (res as { id?: string }).id ?? null, sentBy: 'am-report cron',
    },
  })

  return NextResponse.json({ ok: true, shopify, subject: report.subject })
}
