import { db } from '@/lib/db'

/**
 * Who an inbound address actually is.
 *
 * Exact match first — email or aliasEmails, same as everywhere else identity
 * is checked. Then phone: a text that arrives by email comes from whatever
 * gateway domain the carrier happens to use (3106223898@tmomail.net,
 * @vtext.com, @txt.att.net, and it can differ message to message on some
 * carriers), so there is no fixed address to enumerate the way aliasEmails
 * does for a real inbox. The number itself is the only stable part, and it
 * shows up as a run of digits somewhere in the local part. Brandon, 22 Sept
 * 2026: "if mouse receives an email-text from any address with
 * 310-622-3898 in it, it's from Cleo."
 *
 * A substring match, not equality — deliberately loose, because the point is
 * to stop Mouse guessing at who a bare gateway address belongs to, not to
 * validate that address is well-formed.
 */
export type IdentityCandidate = {
  id: string
  name: string
  email: string | null
  aliasEmails: string | null
  phone: string | null
}

/**
 * The matching itself, apart from the database — exact address first, then
 * the phone-digit substring, so it can be tested without a Person to fetch.
 * A short or missing `phone` is never matched against: a 3-digit remainder
 * from a badly-cleaned number would otherwise hit almost any address.
 */
export function matchInboundAddress(
  fromAddress: string,
  people: IdentityCandidate[],
): { id: string; name: string } | null {
  const address = fromAddress.trim().toLowerCase()
  if (!address) return null

  for (const p of people) {
    const addresses = [p.email, ...(p.aliasEmails ?? '').split(',')]
      .map((a) => (a ?? '').trim().toLowerCase())
      .filter(Boolean)
    if (addresses.includes(address)) return { id: p.id, name: p.name }
  }

  for (const p of people) {
    const digits = (p.phone ?? '').replace(/\D/g, '')
    if (digits.length >= 7 && address.includes(digits)) return { id: p.id, name: p.name }
  }

  return null
}

export async function personFromInboundAddress(
  fromAddress: string,
): Promise<{ id: string; name: string } | null> {
  const people = await db.person.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, aliasEmails: true, phone: true },
  })
  return matchInboundAddress(fromAddress, people)
}
