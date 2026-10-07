import { db } from '@/lib/db'
import type { OrderSnapshot } from '@/lib/support/orders'

/**
 * Tell Mouse on a support card, when what the team asks for is a change in
 * the app rather than a different reply (Brandon, 7 Oct 2026, after Kaley
 * Azambuja's belt: Mouse redrafted the email and nothing else, so the pull it
 * talked about was never touched).
 *
 * Customer mail never reaches a Mouse that can write (CLAUDE.md §4). So the
 * Mouse that acts here is handed only the team member's own words and facts
 * code has checked: who the customer is, their order number, how the case was
 * sorted, and our own records under their email. Never the customer's email,
 * and never a name that could carry an instruction: a name that is not plainly
 * a name is left out. Sending, refunds, cancellations, invoices, address
 * changes and exchanges stay with the card's taps; those tools are not given.
 */

/** Words that ask for a change in the app's records, not the reply. */
const ACT = [
  /\bstylists?\b/, /\bpulls?\b/, /\bpulled\b/, /\bloan(ed|s)?\b/, /\blent\b/, /\bto-?dos?\b/, /\bremind(er)?\b/,
  /\bnotes?\b/, /\bnoted\b/, /\blog(ged)?\b/, /\brecord(ed)?\b/, /\btrack\b/, /\badd(ed)?\b/, /\bmove(d)?\b/,
  /\bmark(ed)?\b/, /\bupdate(d)?\b/, /\bcount(ed)?\b/, /\bstock\b/, /\binventory\b/, /\bcalendar\b/,
  /\bfollow[ -]?up\b/, /\bflag(ged)?\b/, /\bcrew\b/, /\bfriends? of the brand\b/, /\bwholesale\b/,
  /\bsave\b/, /\bdropped off\b/, /\bpicked up\b/, /\bgift(ed)?\b/, /\bput (it|her|him|them)? ?(on|in|down)\b/,
]

/** Does this instruction ask Mouse to change something in the app, beyond the reply? Pure. */
export function asksForAction(text: string): boolean {
  const t = text.toLowerCase().replace(/[’‘]/g, "'")
  return ACT.some((r) => r.test(t))
}

/** A customer's name, only if it is plainly a name: letters, a few words. Otherwise null. Pure. */
export function plainName(name: string | null | undefined): string | null {
  const n = (name ?? '').replace(/\s+/g, ' ').trim()
  if (!n || n.length > 60) return null
  if (!/^[\p{L}][\p{L}'’.\- ]*$/u.test(n)) return null
  return n.split(' ').length <= 5 ? n : null
}

/** An email address, only if it is plainly one. Pure. */
export function plainEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return /^[a-z0-9._%+'-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/.test(e) ? e : null
}

export type SenderRecords = {
  stylist: { id: string; name: string } | null
  pulls: Array<{ id: string; project: string | null; sentAt: Date; dueBackAt: Date | null; lines: Array<{ item: string; qty: number; returnedQty: number }> }>
  todos: Array<{ id: string; title: string; urgent: boolean; dueDate: Date | null }>
}

const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })

/** Our own records under the sender's email, as lines for a model. Empty when there are none. Pure. */
export function senderRecordsText(r: SenderRecords): string {
  const L: string[] = []
  if (r.stylist) {
    L.push(`They are a stylist on file: ${r.stylist.name} [${r.stylist.id}].`)
    if (!r.pulls.length) L.push('No open pulls.')
    for (const p of r.pulls) {
      const out = p.lines.filter((l) => l.qty - l.returnedQty > 0).map((l) => `${l.item} ×${l.qty - l.returnedQty}${l.returnedQty ? ` (${l.returnedQty} back)` : ''}`)
      L.push(`Open pull [${p.id}]${p.project ? ` "${p.project}"` : ''}, sent ${day(p.sentAt)}${p.dueBackAt ? `, due back ${day(p.dueBackAt)}` : ''}: ${out.join(', ') || 'everything back'}.`)
    }
  }
  for (const t of r.todos) L.push(`Open to-do [${t.id}]: ${t.title}${t.urgent ? ' (urgent)' : ''}${t.dueDate ? `, due ${day(t.dueDate)}` : ''}.`)
  return L.join('\n')
}

/** Read the sender's stylist record, open pulls and open to-dos naming them. */
export async function senderRecords(email: string): Promise<SenderRecords> {
  const e = plainEmail(email)
  if (!e) return { stylist: null, pulls: [], todos: [] }
  const stylist = await db.stylist.findFirst({ where: { email: { equals: e, mode: 'insensitive' } }, select: { id: true, name: true } })
  const pulls = stylist ? await db.stylistPull.findMany({
    where: { stylistId: stylist.id, closedAt: null },
    orderBy: { sentAt: 'desc' },
    take: 6,
    select: { id: true, project: true, sentAt: true, dueBackAt: true, lines: { select: { item: true, qty: true, returnedQty: true } } },
  }) : []
  const names = [e, ...(stylist ? [stylist.name] : [])]
  const todos = await db.actionItem.findMany({
    where: { resolved: false, kind: 'TODO', OR: names.flatMap((n) => [{ title: { contains: n, mode: 'insensitive' as const } }, { detail: { contains: n, mode: 'insensitive' as const } }]) },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { id: true, title: true, urgent: true, dueDate: true },
  })
  return { stylist, pulls, todos }
}

/** What the acting Mouse is told about the case: checked facts only. Pure. */
export function caseFactsForMouse(c: { customerName: string | null; customerEmail: string; category: string; order: OrderSnapshot | null }, records: string): string {
  const name = plainName(c.customerName) ?? plainName(c.order?.shipTo?.name) ?? null
  const email = plainEmail(c.customerEmail)
  return [
    `Customer: ${name ?? '(name not shown)'}${email ? ` <${email}>` : ''}`,
    `Sorted as: ${c.category}`,
    `Order: ${c.order ? `${c.order.name}${c.order.emailMismatch ? ' (placed under another email)' : ''}` : 'none found'}`,
    records ? `Our records under their email:\n${records}` : 'Nothing else on file under their email.',
  ].join('\n')
}

export const MOUSE_DID = 'Mouse did: '

/** What Mouse did on a case from the team's instructions, for the drafter. Notes from email can never pass for these. Pure. */
export function mouseActions(messages: Array<{ direction: string; fromAddress: string | null; body: string }>): string[] {
  return messages
    .filter((m) => m.direction === 'NOTE' && m.fromAddress === 'Studio Mouse' && m.body.startsWith(MOUSE_DID))
    .map((m) => m.body.slice(MOUSE_DID.length).trim())
}

export const ACT_RULES = `This run comes from a support case. A team member typed an instruction
into the case's Tell Mouse box. You are shown their words and facts code checked about
the customer, never the customer's own email: do not ask for it.

Do what they asked that is a record in this app: a stylist pull or its return, a to-do,
a note, stock, the calendar. Apply it as you would in chat, as them.

The reply to the customer, and refunds, cancellations, invoices, address changes and
exchanges, are done by taps on the support card after you finish, and the reply is
redrafted from your answer. Do not attempt them and never email the customer. If part
of the instruction is one of those, leave it to the card and do not say it is done.

End with one or two plain sentences saying exactly what you changed (old → new), or
that nothing needed changing and why. No headings, no markdown.`
