import { Resend } from 'resend'

/** Thin wrapper so the provider can be swapped without touching callers. */
export async function sendEmail(opts: {
  subject: string
  text: string
  to?: string[]
  cc?: string[]
  /** Rarely needed: the From address (mouse@) is on the inbound allowlist,
   *  so replies come back into the system and get read on the nightly pass.
   *  A LIST is allowed and is what forwarded mail uses — RFC 5322 permits
   *  several, and mail clients put all of them in the To line when someone
   *  hits reply. That is how a forward can reach the original sender and
   *  keep Studio Mouse copied without anyone remembering to do it. */
  replyTo?: string | string[]
  /** A vendor has no login for this app, so a linked document is a dead
   *  end for them — the bytes have to actually go in the email. */
  attachments?: Array<{ filename: string; content: Buffer }>
}) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  /**
   * Local runs share this project's real Resend key and its real database —
   * there is no staging copy of either. So a test that exercises a send path
   * sends, to real people. On 9 Sept 2026 two test forwards reached Cleo and
   * Brandon because a stubbed sendEmail did nothing: ESM binds the import
   * inside the calling module, and reassigning the export never touched it.
   * The stub reported success and no mail appeared to go out, which is the
   * exact failure shape CLAUDE.md §6 warns about.
   *
   * EMAIL_DRY_RUN makes that impossible from the one place every send passes
   * through, rather than from a stub each caller has to remember to install.
   */
  if (process.env.EMAIL_DRY_RUN) {
    console.log('[EMAIL_DRY_RUN] would send', JSON.stringify({
      to: opts.to, cc: opts.cc, replyTo: opts.replyTo, subject: opts.subject,
      attachments: opts.attachments?.map((a) => a.filename),
      text: opts.text,
    }, null, 2))
    return { sent: true, id: 'dry-run', dryRun: true as const }
  }
  const to = opts.to ?? (process.env.DIGEST_RECIPIENTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!key || !from || !to.length) {
    return { sent: false, reason: 'email not configured' }
  }
  const res = await new Resend(key).emails.send({
    from, to, subject: opts.subject, text: opts.text,
    ...(opts.cc ? { cc: opts.cc } : {}),
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
  })
  if (res.error) return { sent: false, reason: res.error.message }
  return { sent: true, id: res.data?.id }
}
