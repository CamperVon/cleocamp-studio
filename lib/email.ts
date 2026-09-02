import { Resend } from 'resend'

/** Thin wrapper so the provider can be swapped without touching callers. */
export async function sendEmail(opts: {
  subject: string
  text: string
  to?: string[]
  cc?: string[]
  /** Rarely needed: the From address (mouse@) is on the inbound allowlist,
   *  so replies come back into the system and get read on the nightly pass. */
  replyTo?: string
}) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  const to = opts.to ?? (process.env.DIGEST_RECIPIENTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!key || !from || !to.length) {
    return { sent: false, reason: 'email not configured' }
  }
  const res = await new Resend(key).emails.send({
    from, to, subject: opts.subject, text: opts.text,
    ...(opts.cc ? { cc: opts.cc } : {}),
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  })
  if (res.error) return { sent: false, reason: res.error.message }
  return { sent: true, id: res.data?.id }
}
