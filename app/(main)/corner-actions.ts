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
  const meId = await currentPersonId()
  const me = meId ? await db.person.findFirst({ where: { id: meId, active: true, external: false }, select: { name: true } }) : null
  if (!me) return { ok: false, error: 'Open the app from your own link so this carries your name.' }
  if (!(to in TEAM)) return { ok: false, error: 'Who to?' }
  const them = await db.person.findUnique({ where: { id: TEAM[to] }, select: { name: true, email: true } })
  if (!them?.email) return { ok: false, error: `No email on file for ${to}.` }
  const text = item.trim().slice(0, 4000)
  if (!text) return { ok: false, error: 'Nothing to send.' }
  const first = them.name.split(/\s+/)[0]
  const body = [`Hi ${first},`, `${me.name} sent you this from Mouse's Corner:`, text, note.trim() ? `${me.name}: ${note.trim()}` : '', '— Studio Mouse'].filter(Boolean).join('\n\n')
  const res = await sendEmail({ to: [them.email], subject: `From Mouse's Corner, via ${me.name}`, text: body })
  if (!res.sent) return { ok: false, error: `It did not send (${res.reason ?? 'no reason given'}).` }
  return { ok: true, message: `Sent to ${first}.` }
}
