import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { fetchInboundAttachments, type InboundAttachmentMeta } from '@/lib/inbound-attachments'
import { htmlToText } from '@/lib/html-to-text'

/**
 * Forward mail that arrives at a Studio Mouse mailbox on to the people who
 * should have been cc'd.
 *
 * Brandon, 9 Sept 2026: "some people only respond to SM and forget to hit cc."
 * A vendor hits reply on a purchase order, the answer lands in Mouse's mailbox
 * and nowhere else, and nobody knows the ship date moved until someone thinks
 * to look. Mouse reading it overnight is not the same as a person seeing it.
 *
 * The reply-to is the point, not the copy. It carries the original sender AND
 * Mouse's own address, so hitting reply on a forward reaches the vendor and
 * keeps Mouse in the thread without anyone remembering to cc anything — which
 * is the habit that caused this in the first place. Fixing the habit by asking
 * people to have a better habit does not work.
 *
 * Nothing here interprets the mail. Forwarding is a copy; CLAUDE.md §4 still
 * holds, and facts from email still become proposals a human confirms.
 */

/** Addresses that mean "a machine sent this", never a person waiting on a reply. */
const MACHINE_SENDER = /(^|[<.])(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|notifications?)@/i

/**
 * Headers that say a message was generated automatically. Forwarding an
 * out-of-office to two people who then reply to it is how a mail loop starts,
 * and a loop between two of our own addresses would run until someone noticed.
 */
function looksAutomated(raw: unknown): boolean {
  const headers = (raw as { data?: { headers?: Array<{ name?: string; value?: string }> } })?.data?.headers
  if (!Array.isArray(headers)) return false
  for (const h of headers) {
    const name = (h?.name ?? '').toLowerCase()
    const value = (h?.value ?? '').toLowerCase()
    if (name === 'auto-submitted' && value !== 'no') return true
    if (name === 'x-autoreply' || name === 'x-autorespond') return true
    if (name === 'precedence' && /bulk|auto_reply|junk|list/.test(value)) return true
    if (name === 'list-unsubscribe') return true
  }
  return false
}

const bare = (a: string) => a.toLowerCase().replace(/^.*</, '').replace(/>.*$/, '').trim()

/**
 * A person is an inbox, or several. Brandon sends from bc@thecampbrand.com as
 * often as brandon@cleocamp.com; Cleo sends from studio@cleocamp.com. Neither
 * is the address anything downstream is configured to recognise, so matching
 * the sender against one literal email — which is what this used to do —
 * silently never caught either of them. Every real forward tested this
 * session went out to both, including mail Brandon or Cleo had themselves
 * just sent or forwarded.
 *
 * Resolves who actually sent a message, by every address on file for them —
 * see Person.aliasEmails.
 */
async function resolvePerson(address: string): Promise<{ id: string; name: string; addresses: string[] } | null> {
  const bareAddr = bare(address)
  const people = await db.person.findMany({
    where: { active: true, OR: [{ email: { not: null } }, { aliasEmails: { not: null } }] },
    select: { id: true, name: true, email: true, aliasEmails: true },
  })
  for (const p of people) {
    const addresses = [p.email, ...(p.aliasEmails ?? '').split(',')].filter(Boolean).map((a) => bare(a!))
    if (addresses.includes(bareAddr)) return { id: p.id, name: p.name, addresses }
  }
  return null
}

/**
 * Everyone already on the original message — its own To and Cc, straight
 * from Resend's payload, not the flattened toAddress column (that only ever
 * held To). Brandon, 11 Sept: "SM doesn't need to forward emails that I am
 * cc'd on." If he was already cc'd on the mail that hit mouse@, forwarding
 * it to him is the exact noise this feature exists to remove, just arriving
 * from the opposite direction — the sender already reached him directly.
 */
function originalRecipients(raw: unknown): string[] {
  const d = (raw as { data?: { to?: unknown; cc?: unknown } })?.data
  const flatten = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return [...flatten(d?.to), ...flatten(d?.cc)].map(bare)
}

export type ForwardOutcome =
  | { forwarded: true; to: string[] }
  | { forwarded: false; reason: string }

export async function forwardInboundEmail(inboundEmailId: string): Promise<ForwardOutcome> {
  const settings = await db.notificationSettings.findUnique({ where: { id: 'singleton' } })
  // Absent settings row means nobody has switched anything off — the schema
  // default is on, and defaulting to silence would be the failure this is
  // meant to fix.
  if (settings && !settings.forwardInboundEnabled) return { forwarded: false, reason: 'forwarding is switched off' }

  const email = await db.inboundEmail.findUnique({ where: { id: inboundEmailId } })
  if (!email) return { forwarded: false, reason: 'no such email' }
  if (email.forwardedAt) return { forwarded: false, reason: 'already forwarded' }

  const recipients = (settings?.forwardInboundTo ?? process.env.DIGEST_RECIPIENTS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (!recipients.length) return { forwarded: false, reason: 'nobody configured to forward to' }

  const from = bare(email.fromAddress)

  if (MACHINE_SENDER.test(from)) return { forwarded: false, reason: 'automated sender' }
  if (looksAutomated(email.raw)) return { forwarded: false, reason: 'auto-generated message' }
  // Our own outgoing address. Mouse's sent mail can land back here via a
  // catch-all or a list; forwarding it would bounce our own words back at us.
  if (process.env.EMAIL_FROM && from === bare(process.env.EMAIL_FROM)) {
    return { forwarded: false, reason: 'sent by us' }
  }

  // Mail Brandon or Cleo sent or forwarded is not news to Brandon or Cleo.
  // Forwarding it back to either of them is exactly the noise this feature
  // was built to remove, just arriving from a different address than the one
  // anything was configured to recognise — which is the whole reason the
  // alias table above exists; a plain string match already tried this and
  // never once fired, because Brandon and Cleo do not send from the addresses
  // they receive at.
  //
  // Brandon and Cleo are each other's redundancy here, not independent
  // recipients: if either one sent or forwarded this, the other already
  // shares an inbox, a desk and a text thread with them, and both are the
  // exact two people this feature exists to protect. So a sender identified
  // as either one suppresses BOTH from the recipient list — anyone else
  // configured to receive forwards (Jane, Nicki, if that ever happens) is
  // unaffected, because they are not who sent it and are not redundant with
  // whoever did.
  const INTERNAL = new Set(['per_brandon', 'per_cleo'])
  const sender = await resolvePerson(email.fromAddress)
  let others = recipients
  if (sender && INTERNAL.has(sender.id)) {
    const resolved = await Promise.all(recipients.map(async (r) => ({ address: r, who: await resolvePerson(r) })))
    others = resolved.filter(({ who }) => !(who && INTERNAL.has(who.id))).map(({ address }) => address)
  } else if (sender) {
    // Some other known person (Jane, Nicki) sent it. Only they themselves are
    // redundant — everyone else configured to receive forwards still should.
    others = recipients.filter((r) => bare(r) !== bare(email.fromAddress))
  }
  if (!others.length) return { forwarded: false, reason: 'sender is the only recipient' }

  // Drop anyone already on the original To/Cc — Brandon, 11 Sept: "SM
  // doesn't need to forward emails that I am cc'd on." They already got this
  // straight from whoever sent it; a forward on top is the same redundancy
  // this feature exists to remove, just aimed the other way. Checked against
  // every address on file for the recipient (Person.aliasEmails), not just
  // the one address they're configured to be forwarded at — being cc'd as
  // bc@thecampbrand.com still means Brandon already has it.
  const alreadyOn = originalRecipients(email.raw)
  if (alreadyOn.length) {
    const resolved = await Promise.all(others.map(async (r) => {
      const who = await resolvePerson(r)
      const addresses = who?.addresses ?? [bare(r)]
      return { address: r, hasIt: addresses.some((a) => alreadyOn.includes(a)) }
    }))
    others = resolved.filter(({ hasIt }) => !hasIt).map(({ address }) => address)
  }
  if (!others.length) return { forwarded: false, reason: 'recipient(s) already on the original message' }

  // Claim it before sending. Two concurrent webhook deliveries — Resend
  // retries anything it thinks failed — must not both send. updateMany with
  // the null check is a compare-and-swap: exactly one caller gets count 1.
  const claim = await db.inboundEmail.updateMany({
    where: { id: email.id, forwardedAt: null },
    data: { forwardedAt: new Date() },
  })
  if (claim.count !== 1) return { forwarded: false, reason: 'already forwarded' }

  // The files are the reason this matters. Betsy at RichLine sent the packing
  // list and the invoice for PO 2361 to Mouse and nobody else; a forward that
  // says "there were attachments" is a forward that still needs someone to go
  // and look, which is the trip this is meant to save.
  const raw = email.raw as { data?: { email_id?: string; attachments?: InboundAttachmentMeta[] } }
  const resendId = raw?.data?.email_id
  const attachments = resendId
    ? await fetchInboundAttachments(resendId, raw?.data?.attachments ?? [])
    : { files: [], omitted: [] }

  const received = email.receivedAt.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short',
  })
  // Filtered on its own, so dropping an absent line cannot also swallow the
  // blank lines that separate the header from the message.
  const header = [
    `From: ${email.fromAddress}`,
    `To: ${email.toAddress}`,
    `Received: ${received}`,
    attachments.files.length
      ? `Attached: ${attachments.files.map((f) => f.filename).join(', ')}`
      : null,
    // Never silently drop a file. Someone who knows an invoice was sent needs
    // to be told it is not on this mail, not left to wonder.
    attachments.omitted.length
      ? `Not attached: ${attachments.omitted.map((o) => `${o.filename} (${o.why})`).join(', ')} — open it in the app`
      : null,
  ].filter((l): l is string => l !== null)

  // A Gmail reply commonly carries only an HTML part — Nicki's real pricing
  // update from Antonio ($9.50/pc, $8.50/pc over 1000 units, no deposit, a
  // 2-3 week timeline) went out twice today as "(no plain-text body — open
  // it in the app)" for exactly this reason. Fall back to a stripped-down
  // reading of the HTML rather than an empty-looking notification; only say
  // there is truly nothing to read when neither part exists at all.
  const readableBody =
    email.text?.trim() ||
    (email.html ? htmlToText(email.html) : '') ||
    '(this message has no readable body — open it in the app)'

  const body = [
    ...header,
    '',
    'Replying to this reaches the sender, with Studio Mouse copied automatically.',
    '',
    '—'.repeat(20),
    '',
    readableBody,
  ].join('\n')

  const res = await sendEmail({
    to: others,
    subject: `Fwd: ${email.subject ?? '(no subject)'}`,
    text: body,
    // The sender first, so a client that honours only one uses theirs. Mouse
    // second, so the thread comes back in and gets read on the nightly pass.
    replyTo: [email.fromAddress, ...(process.env.EMAIL_FROM ? [process.env.EMAIL_FROM] : [])],
    ...(attachments.files.length ? { attachments: attachments.files } : {}),
  })

  if (!res.sent) {
    // Give the claim back. A message nobody saw is worse than one seen twice,
    // and leaving forwardedAt set on a send that failed would hide it forever.
    await db.inboundEmail.update({ where: { id: email.id }, data: { forwardedAt: null } })
    return { forwarded: false, reason: res.reason ?? 'send failed' }
  }
  return { forwarded: true, to: others }
}
