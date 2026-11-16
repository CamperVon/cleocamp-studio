import { db } from '@/lib/db'
import { normalizeSubject } from '@/lib/support/core'

/**
 * Stylist mail raises an urgent to-do the moment it lands (15 Nov 2026).
 * Asked in chat after stylist pull requests and "Cleo Camp x ___" emails
 * went unanswered too long that week.
 *
 * Code decides, from the subject and the opening of the body, never a model,
 * and the to-do it raises is fixed wording with the subject quoted. Email is
 * data: nothing here writes anything but that one reminder, which a person
 * ticks off once the stylist has an answer. One open to-do per conversation,
 * so a stylist replying three times in a thread is still one reminder; once
 * it is ticked off, the next message in that thread raises a fresh one.
 */

/** Machines and lists, which never ask for a pull. Narrower than support's: a stylist agency can write from info@. */
const MACHINE = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)[+@._-]|@(.*\.)?(shopify(email)?\.com|mailchimp\.com|sendgrid\.net|amazonses\.com|google\.com|facebookmail\.com|intuit\.com)$/i
/** Our own addresses: a reply from the team is not a new request, a forward of one is. */
const OURS = /@(send\.)?cleocamp\.com$/i
const FORWARD = /^\s*(fwd?|tr)\s*:/i

const COLLAB_SUBJECT = /\bcleo\s*camp\s*[x×]\s*\S/i
const PULL_SUBJECT = /\bpulls?\b/i
const PULL_BODY = /\b(pull request|request(?:ing)? (?:a |to )?pull|pull (?:for|of|from)|for (?:a|our|my|the) pull|pulling (?:for|some|a few))\b/i

/** The bare address in a From line. Pure. */
export function senderAddress(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim().toLowerCase()
}

/** Why this email is stylist mail that wants an answer, or null. Pure. */
export function stylistMailReason(m: { from: string; subject: string | null; text: string | null }): 'collab' | 'pull' | null {
  const from = senderAddress(m.from)
  const subject = m.subject ?? ''
  if (MACHINE.test(from)) return null
  if (OURS.test(from) && !FORWARD.test(subject)) return null
  if (COLLAB_SUBJECT.test(subject)) return 'collab'
  if (PULL_SUBJECT.test(subject)) return 'pull'
  // The opening only: a long thread quotes everything ever said further down.
  if (PULL_BODY.test((m.text ?? '').slice(0, 1500))) return 'pull'
  return null
}

/** The sender as a person would say it: "Ana Ruiz" or the address. Pure. */
export function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim()
  return name && !name.includes('@') ? name : senderAddress(from)
}

/** The to-do's words. Fixed apart from the quoted subject and sender. Pure. */
export function stylistTodoTitle(m: { from: string; subject: string | null }, reason: 'collab' | 'pull'): string {
  const subject = (m.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || '(no subject)'
  const what = reason === 'collab' ? 'Answer the stylist email' : 'Answer the stylist pull request'
  return `${what} "${subject}" from ${senderName(m.from).slice(0, 80)}`
}

/** The key that keeps one open to-do per conversation. Pure. */
export const stylistMailKey = (subject: string | null) => `stylist-mail:${normalizeSubject(subject).slice(0, 200)}`

/**
 * Raise the urgent to-do for one stored email, unless an open one for the
 * same conversation already exists. Returns the to-do's id, or null.
 */
export async function raiseStylistMail(emailId: string): Promise<string | null> {
  const e = await db.inboundEmail.findUnique({ where: { id: emailId }, select: { fromAddress: true, subject: true, text: true, receivedAt: true } })
  if (!e) return null
  const reason = stylistMailReason({ from: e.fromAddress, subject: e.subject, text: e.text })
  if (!reason) return null
  const dedupeKey = stylistMailKey(e.subject)
  const open = await db.alert.findFirst({ where: { dedupeKey, resolved: false }, select: { id: true, relatedActionItem: { select: { resolved: true } } } })
  if (open && open.relatedActionItem && !open.relatedActionItem.resolved) return null
  if (open) await db.alert.update({ where: { id: open.id }, data: { resolved: true, resolvedAt: new Date() } })
  const when = e.receivedAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const item = await db.actionItem.create({
    data: {
      kind: 'TODO', source: 'EMAIL', urgent: true,
      title: stylistTodoTitle({ from: e.fromAddress, subject: e.subject }, reason),
      detail: `Came in ${when}, from ${senderAddress(e.fromAddress)}. It is in the Inbox. Tick this off once the stylist has an answer.`,
      alerts: { create: { severity: 'URGENT', dedupeKey, message: 'Stylist email waiting for an answer' } },
    },
    select: { id: true },
  })
  return item.id
}
