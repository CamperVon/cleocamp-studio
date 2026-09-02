import { Resend } from 'resend'

/** Thin wrapper so the provider can be swapped without touching callers. */
export async function sendEmail(opts: { subject: string; text: string; to?: string[] }) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  const to = opts.to ?? (process.env.DIGEST_RECIPIENTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!key || !from || !to.length) {
    return { sent: false, reason: 'email not configured' }
  }
  const res = await new Resend(key).emails.send({
    from, to, subject: opts.subject, text: opts.text,
  })
  if (res.error) return { sent: false, reason: res.error.message }
  return { sent: true, id: res.data?.id }
}
