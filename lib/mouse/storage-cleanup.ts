import { db } from '@/lib/db'

/**
 * Clears the heavy content of old, already-used emails and attachments —
 * not the records of them. Brandon, 4 Sept 2026: "we don't need to keep
 * emails or pdfs etc as long as it has taken the relevant info."
 *
 * "Taken the relevant info" is the whole condition, so this is narrower than
 * a blanket age cutoff:
 *   - InboundEmail: only rows with processedAt set — the nightly pass has
 *     already read it and raised whatever it needed to. An unprocessed email
 *     is never touched, however old; that would be losing mail, not tidying.
 *   - ChatAttachment: every attachment is read synchronously in the turn it
 *     arrives, so age alone is enough — there's no "unprocessed" state to
 *     protect here.
 *
 * Runs off its own timestamp (StorageCleanup, one row) rather than a cron
 * schedule, since "every two months" has no home in Vercel Hobby's
 * once-a-day cron. Called from the nightly job, which is cheap to check and
 * mostly a no-op — the real work happens roughly every 60th time it runs.
 */
const INTERVAL_DAYS = 60

export async function cleanupStorage(opts: { dryRun?: boolean } = {}) {
  const marker = await db.storageCleanup.findUnique({ where: { id: 'singleton' } })
  const daysSince = marker?.lastRunAt ? (Date.now() - marker.lastRunAt.getTime()) / 864e5 : Infinity
  if (daysSince < INTERVAL_DAYS) {
    return { ran: false, reason: `last run ${Math.floor(daysSince)}d ago, due at ${INTERVAL_DAYS}d` }
  }

  const cutoff = new Date(Date.now() - INTERVAL_DAYS * 864e5)
  const emailWhere = { processedAt: { not: null }, receivedAt: { lt: cutoff }, text: { not: null } } as const
  const fileWhere = { createdAt: { lt: cutoff }, data: { not: null } } as const

  if (opts.dryRun) {
    const [emails, files] = await Promise.all([
      db.inboundEmail.count({ where: emailWhere }),
      db.chatAttachment.count({ where: fileWhere }),
    ])
    return { ran: false, dryRun: true, wouldPurge: { emails, files }, cutoff: cutoff.toISOString().slice(0, 10) }
  }

  const [emails, files] = await Promise.all([
    // raw can't go to null (it's required — kept as the audit trail of shape
    // for the webhook), so it's replaced with a small marker instead of the
    // full payload, which is what was actually taking the space.
    db.inboundEmail.updateMany({
      where: emailWhere,
      data: { text: null, html: null, raw: { purged: true, purgedAt: new Date().toISOString() } },
    }),
    db.chatAttachment.updateMany({ where: fileWhere, data: { data: null } }),
  ])

  await db.storageCleanup.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', lastRunAt: new Date(), emailsPurged: emails.count, filesPurged: files.count },
    update: {
      lastRunAt: new Date(),
      emailsPurged: { increment: emails.count },
      filesPurged: { increment: files.count },
    },
  })

  return { ran: true, emailsPurged: emails.count, filesPurged: files.count, cutoff: cutoff.toISOString().slice(0, 10) }
}
