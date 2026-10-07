'use server'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'
import { sendEmail } from '@/lib/email'

/**
 * Send one item from Mouse's Corner to a teammate. Brandon, 2 Oct 2026:
 * "make the items drop down. the drop down option is to email Cleo, Jane or
 * Brandon." Goes to their address on file, from the person who tapped.
 */
const TEAM = { cleo: 'per_cleo', jane: 'per_jane', brandon: 'per_brandon' } as const
export type Teammate = keyof typeof TEAM

export async function emailCornerItem(to: Teammate, item: string, note: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  return emailTeammate(to, { from: "Mouse's Corner", text: item, note })
}

/**
 * Send something in the app to a teammate, from the person who tapped, to
 * their address on file. Used by Mouse's Corner and by Ping Jane / Ping Cleo
 * on stylist requests and pulls (Brandon, 7 Oct 2026).
 */
export async function emailTeammate(to: Teammate, what: { from: string; text: string; note?: string; link?: string }): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const meId = await currentPersonId()
  const me = meId ? await db.person.findFirst({ where: { id: meId, active: true, external: false }, select: { name: true } }) : null
  if (!me) return { ok: false, error: 'Open the app from your own link so this carries your name.' }
  if (!(to in TEAM)) return { ok: false, error: 'Who to?' }
  const them = await db.person.findUnique({ where: { id: TEAM[to] }, select: { name: true, email: true } })
  if (!them?.email) return { ok: false, error: `No email on file for ${to}.` }
  const text = what.text.trim().slice(0, 4000)
  if (!text) return { ok: false, error: 'Nothing to send.' }
  const first = them.name.split(/\s+/)[0]
  const note = what.note?.trim()
  const body = [`Hi ${first},`, `${me.name} sent you this from ${what.from}:`, text, note ? `${me.name}: ${note}` : '', what.link ? `Open it: ${what.link}` : '', '— Studio Mouse'].filter(Boolean).join('\n\n')
  const res = await sendEmail({ to: [them.email], subject: `From ${what.from}, via ${me.name}`, text: body })
  if (!res.sent) return { ok: false, error: `It did not send (${res.reason ?? 'no reason given'}).` }
  return { ok: true, message: `Sent to ${first}.` }
}
