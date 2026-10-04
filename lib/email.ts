import { Resend } from 'resend'

/**
 * An address on cleocamp.com itself, as opposed to send.cleocamp.com.
 * Brandon, 4 Oct 2026: "i don't want mouse ever using support@ unless we
 * tell it to. this is a one time thing." Cleo's note to everyone waiting on
 * a Cleo Tee went from support@cleocamp.com; everything else the app sends
 * stays on send.cleocamp.com, which keeps its reputation apart from the
 * team's Google Workspace mail. So the root domain is refused here, in the
 * one place every send passes through, unless a person ticked it for that
 * send (lib/waiting-notice.ts). Shopify invoices from studio@ do not come
 * through here and are unaffected.
 */
export const ROOT_DOMAIN_FROM = /@cleocamp\.com>?\s*$/i

/** Thin wrapper so the provider can be swapped without touching callers. */
export async function sendEmail(opts: {
  subject: string
  text: string
  /** Rendered alongside `text`. Every send still carries a plain-text part —
   *  this only adds a designed version on top, never replaces the fallback. */
  html?: string
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
   *  end for them — the bytes have to actually go in the email. With a
   *  `contentId`, a picture shows inside the HTML wherever it says
   *  `<img src="cid:…">` (lib/notice-pictures.ts). */
  attachments?: Array<{ filename: string; content: Buffer; contentId?: string }>
  /** Overrides EMAIL_FROM. Customer replies go out as Cleo Studio from
   *  support@, never as Studio Mouse — see app/(main)/support/actions.ts. */
  from?: string
  /** Threading, for a reply: In-Reply-To / References to the customer's
   *  own message, so it lands in their conversation rather than a new one. */
  headers?: Record<string, string>
  /** Only a person's one-off choice on Special sets this: see ROOT_DOMAIN_FROM. */
  personChoseRootFrom?: boolean
}) {
  const key = process.env.RESEND_API_KEY
  const from = opts.from ?? process.env.EMAIL_FROM

  // Checked before the dry run, so a test sees the refusal too.
  if (from && ROOT_DOMAIN_FROM.test(from) && !opts.personChoseRootFrom) {
    return { sent: false, reason: 'support@cleocamp.com is only used when a person picks it for one send on Special' }
  }

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
      from: opts.from, to: opts.to, cc: opts.cc, replyTo: opts.replyTo, subject: opts.subject, headers: opts.headers,
      attachments: opts.attachments?.map((a) => a.filename),
      text: opts.text,
      html: opts.html ? '(html body omitted from log)' : undefined,
    }, null, 2))
    return { sent: true, id: 'dry-run', dryRun: true as const }
  }
  const to = opts.to ?? (process.env.DIGEST_RECIPIENTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!key || !from || !to.length) {
    return { sent: false, reason: 'email not configured' }
  }
  const res = await new Resend(key).emails.send({
    from, to, subject: opts.subject, text: opts.text,
    ...(opts.html ? { html: opts.html } : {}),
    ...(opts.cc ? { cc: opts.cc } : {}),
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
    ...(opts.headers ? { headers: opts.headers } : {}),
  })
  if (res.error) return { sent: false, reason: res.error.message }
  return { sent: true, id: res.data?.id }
}
