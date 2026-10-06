/**
 * When an email from the team may change things directly. Brandon, 2 Oct
 * 2026: "If cleo or brandon or jane emails info / an answer / changing a
 * number it's a waste of time for it to become an email todo, the info needs
 * to change. especially if mouse asked the damn question!" And then: "the
 * reply all scares me. mouse cc's us all right now."
 *
 * Email stays data, never instructions (CLAUDE.md §4), for everyone else. For
 * the three of them, two conditions, both checked in code:
 *  - it really came from them. The From line can be typed by anyone, so the
 *    receiving server's DMARC result must be "pass": the sending domain's own
 *    mail server signed it. A forged "brandon@cleocamp.com" fails that;
 *  - it is addressed TO Mouse. A reply (or reply-all) to Mouse's own email
 *    has mouse@ in To. A thread with a vendor that merely copies Mouse does
 *    not, so talk among people is never taken as an instruction; it stays a
 *    proposal for a tap, as before.
 * Even then nothing goes out and no money moves from an email: those tools
 * are left out, and Mouse replies only to the sender's address on file, with
 * what it changed.
 */

/** Tools a verified team email may NOT use: anything that sends, invoices, moves money or changes who gets mail. */
export const NOT_FROM_EMAIL = new Set([
  'send_purchase_order', 'send_email', 'send_context_snapshot', 'send_wholesale_draft', 'send_line_sheet',
  'email_invoice_copy', 'invoice_live_sale', 'invoice_wholesale', 'gift_items', 'refund_friends_family',
  'cancel_live_sale', 'update_person_email', 'update_notification_settings', 'record_financials',
  // Takes the newest chat attachment: from an email it would keep the wrong file.
  'keep_file',
])

/** Is Mouse's mailbox in the To line (not just copied)? Pure. */
export function addressedToMouse(toAddress: string): boolean {
  return toAddress.toLowerCase().split(',').some((a) => /(^|<|\s)mouse@send\.cleocamp\.com/.test(a.trim()))
}

/** The receiving server's DMARC verdict from a raw message's own top Authentication-Results header. Pure. */
export function dmarcFromHeaders(rawMessage: string): 'pass' | 'fail' | 'unknown' {
  const head = rawMessage.split(/\r?\n\r?\n/)[0] ?? ''
  // Unfold continuation lines, then take the first (topmost) Authentication-Results:
  // the one the receiving server added. Lower ones could have been written by the sender.
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ')
  const line = unfolded.split(/\r?\n/).find((l) => /^authentication-results:/i.test(l))
  if (!line) return 'unknown'
  const m = /\bdmarc=(\w+)/i.exec(line)
  return !m ? 'unknown' : m[1].toLowerCase() === 'pass' ? 'pass' : 'fail'
}

/** Did this inbound email pass DMARC? Asks Resend; unknown counts as no. */
export async function verifiedSender(emailId: string | undefined): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!emailId || !key) return false
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, { headers: { Authorization: `Bearer ${key}` } })
    if (!r.ok) return false
    const full = (await r.json()) as { authentication?: { dmarc?: string } | null; raw?: { download_url?: string } | null }
    if (full.authentication?.dmarc) return full.authentication.dmarc.toLowerCase() === 'pass'
    if (!full.raw?.download_url) return false
    const raw = await fetch(full.raw.download_url)
    return raw.ok && dmarcFromHeaders(await raw.text()) === 'pass'
  } catch {
    return false
  }
}
