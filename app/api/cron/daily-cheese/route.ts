import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { laMidnight } from '@/lib/dates'
import { sendEmail } from '@/lib/email'
import { composeDailyCheese } from '@/lib/mouse/daily-cheese'

export const maxDuration = 60

// Cleo, 17 Sept 2026: a weekday 8am report — Products in production's red
// items, full sentences, no backstory. Recipient changes with the day
// because Jane only works Tuesday through Thursday, not because the report
// itself is different: "Monday and Friday content should be the same. All
// the important stuff. But Jane only works her three days a week." and
// "Jane only gets emails on her days" — so Monday and Friday go to Cleo,
// Brandon cc'd, Jane NOT cc'd; Tuesday through Thursday go to Jane, Cleo and
// Brandon cc'd. Same vercel.json hour convention as the old am-report cron —
// "0 15 * * 1-5" is 8-9am Pacific while LA is on daylight time; move to
// "0 16 * * 1-5" once DST ends (~1 Nov 2026) if 8am still matters more than
// a fixed UTC hour.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dry') === '1'

  const notify = await db.notificationSettings.findUnique({ where: { id: 'singleton' } })
  if (!notify?.dailyCheeseEnabled) return NextResponse.json({ skipped: 'Daily Cheese switched off' })

  // laMidnight(0) is constructed straight from LA's own calendar date parts,
  // so its UTC day-of-week IS the LA day-of-week — see lib/dates.ts.
  // 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat.
  const dow = laMidnight(0).getUTCDay()
  const recipients =
    dow === 1 || dow === 5 // Monday or Friday
      ? { to: ['cleo@cleocamp.com'], cc: ['brandon@cleocamp.com'] }
      : dow >= 2 && dow <= 4 // Tuesday, Wednesday, Thursday
        ? { to: ['jane@cleocamp.com'], cc: ['cleo@cleocamp.com', 'brandon@cleocamp.com'] }
        : null // weekend — nothing scheduled
  if (!recipients) return NextResponse.json({ skipped: 'weekend' })

  // A retry or a manual poke on the same day must not send twice.
  const today = laMidnight(0)
  const already = await db.sentEmail.findFirst({
    where: { sentBy: 'daily-cheese cron', createdAt: { gte: today } },
  })
  if (already) return NextResponse.json({ skipped: 'already sent today' })

  const { subject, text, html } = await composeDailyCheese()

  if (dryRun) return NextResponse.json({ dryRun: true, recipients, subject, text })

  const res = await sendEmail({ to: recipients.to, cc: recipients.cc, subject, text, html })
  if (!res.sent) return NextResponse.json({ error: res.reason }, { status: 500 })
  if ((res as { dryRun?: boolean }).dryRun) return NextResponse.json({ ok: true, dryRun: true })

  await db.sentEmail.create({
    data: {
      toAddress: recipients.to.join(', '), ccAddress: recipients.cc.join(', '),
      subject, body: text,
      resendId: (res as { id?: string }).id ?? null, sentBy: 'daily-cheese cron',
    },
  })

  return NextResponse.json({ ok: true, recipients, subject })
}
