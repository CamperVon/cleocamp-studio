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
 *    proposal for a tap, as before. The To line is read from the message's
 *    own headers (toLineFromHeaders), never Resend's `to` field.
 *  - copied only, it gets no reply at all unless their own words speak to
 *    Mouse by name (speaksToMouse; Brandon, 14 Oct 2026).
 * Even then nothing goes out and no money moves from an email: those tools
 * are left out, and Mouse replies only to the sender's address on file, with
 * what it changed.
 */

/**
 * Tools a verified team email may NOT use: anything that sends, invoices, moves
 * money or changes who gets mail. A gift (gift_items) is allowed since Brandon,
 * 8 Oct 2026, after Cleo emailed a replacement Bean Bag and Mouse could not
 * make it: a gift only makes a $0 order that waits in Shopify for a person to
 * make the shipping label, so nothing leaves without someone's hand on it.
 * set_order_email is allowed too (Brandon, 12 Oct 2026: "as long as its from
 * us"): it puts an email on a Shopify order, and on its customer only when
 * that has none, never replacing one (lib/shopify-email.ts).
 */
export const NOT_FROM_EMAIL = new Set([
  'send_purchase_order', 'send_email', 'send_context_snapshot', 'send_wholesale_draft', 'send_line_sheet',
  'email_invoice_copy', 'invoice_live_sale', 'invoice_wholesale', 'refund_friends_family',
  'cancel_live_sale', 'update_person_email', 'update_notification_settings', 'record_financials',
  // Takes the newest chat attachment: from an email it would keep the wrong file.
  'keep_file', 'set_colour_photo',
  // Sends our information outside the company.
  'hand_to_muse', 'send_back_to_muse',
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

/**
 * The To line from a raw message's own headers, unfolded. Pure.
 *
 * Not Resend's `to` field: that is the address the mail was delivered to,
 * which for anything reaching Mouse is always mouse@, copied or not. Found
 * 14 Oct 2026: Brandon's reply to a vendor (To: the vendor, Cc: mouse@)
 * arrived with `to: mouse@`, so every copied email from the team had been
 * read as written to Mouse, and acted on.
 */
export function toLineFromHeaders(rawMessage: string): string | null {
  const head = (rawMessage.split(/\r?\n\r?\n/)[0] ?? '').replace(/\r?\n[ \t]+/g, ' ')
  const line = head.split(/\r?\n/).find((l) => /^to:/i.test(l))
  return line ? line.replace(/^to:\s*/i, '').trim() : null
}

/**
 * Does the sender's own text, above anything quoted, speak to Mouse by name?
 * The only way a copied email gets an answer (Brandon, 14 Oct 2026: "If Mouse
 * is cc'd on an email it should not respond unless directly asked a
 * question"). A question to a vendor in the same thread is not Mouse's to
 * answer. Mouse's own address, and quoted text, do not count. Pure.
 */
export function speaksToMouse(body: string): boolean {
  const cut = body.search(/\n[ \t]*On [^\n]{3,200}?(?:\n[^\n]{0,200}?)?\bwrote:|\n[ \t]*-{2,}\s*(Original|Forwarded) Message|\n>|\n[ \t]*From:\s/i)
  const own = (cut >= 0 ? body.slice(0, cut) : body).replace(/[\w.+-]*mouse@[\w.-]+/gi, '')
  return /\b(studio )?mouse\b/i.test(own)
}

/**
 * What the receiving end knows about an inbound email: whether it passed
 * DMARC, and the real To line. One fetch of Resend's record and, when
 * needed, its raw message. Anything unknown counts against: not verified,
 * not addressed to Mouse.
 */
export async function inboundFacts(emailId: string | undefined): Promise<{ verified: boolean; toMouse: boolean }> {
  const key = process.env.RESEND_API_KEY
  const none = { verified: false, toMouse: false }
  if (!emailId || !key) return none
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, { headers: { Authorization: `Bearer ${key}` } })
    if (!r.ok) return none
    const full = (await r.json()) as { authentication?: { dmarc?: string } | null; raw?: { download_url?: string } | null }
    const raw = full.raw?.download_url ? await fetch(full.raw.download_url) : null
    const text = raw?.ok ? await raw.text() : ''
    const dmarc = full.authentication?.dmarc ? (full.authentication.dmarc.toLowerCase() === 'pass' ? 'pass' : 'fail') : dmarcFromHeaders(text)
    const to = text ? toLineFromHeaders(text) : null
    return { verified: dmarc === 'pass', toMouse: !!to && addressedToMouse(to) }
  } catch {
    return none
  }
}
