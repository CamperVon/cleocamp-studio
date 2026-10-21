/**
 * Mouse on WhatsApp (12 Oct 2026), for Brandon, Cleo and Jane only. Telnyx
 * delivers each message to /api/telnyx; a signed WhatsApp message from one of
 * their numbers on file goes into that person's latest conversation, the same
 * one the app shows, and Mouse's answer goes back on WhatsApp. Anyone else's
 * message is kept and nothing more. Telnyx confirms the sending number, so
 * a message from a team member's phone is theirs the way their own sign-in is.
 */
import { db } from '@/lib/db'

export const TEAM_IDS = ['per_brandon', 'per_cleo', 'per_jane']

/** A US number in one form, +1 and ten digits; anything else as digits with a +. Pure. */
export function normalizePhone(s: string | null | undefined): string | null {
  const d = (s ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return d.length >= 8 ? `+${d}` : null
}

/** Whose phone this is, among the team. Pure. */
export function teamMemberFor<P extends { id: string; phone: string | null }>(from: string, people: P[]): P | null {
  const f = normalizePhone(from)
  return (f && people.find((p) => normalizePhone(p.phone) === f)) || null
}

/** Mouse's reply as WhatsApp shows it, in pieces under its 4,096-character limit. Pure. */
export function forWhatsApp(md: string, max = 3900): string[] {
  const text = md
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // bold
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)') // links
    .replace(/\]\((\/[^)]+)\)/g, '] (https://admin.cleocamp.com$1)')
    .trim()
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf('\n\n', max), rest.lastIndexOf('\n', max), rest.lastIndexOf(' ', max))
    const at = cut > max / 2 ? cut : max
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** Send a WhatsApp text through Telnyx. Inside the 24 hours after their message, as a reply always is. */
export async function sendWhatsApp(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.TELNYX_API_KEY?.trim()
  const from = normalizePhone(process.env.WHATSAPP_FROM ?? '+12136190002')
  if (!key || !from) return { ok: false, error: 'TELNYX_API_KEY is not set' }
  if (process.env.EMAIL_DRY_RUN === '1') { console.log('[whatsapp] dry run to', to, text.slice(0, 80)); return { ok: true } }
  const res = await fetch('https://api.telnyx.com/v2/messages/whatsapp', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, whatsapp_message: { type: 'text', text: { body: text, preview_url: false } } }),
  })
  return res.ok ? { ok: true } : { ok: false, error: `Telnyx ${res.status}: ${(await res.text()).slice(0, 300)}` }
}

/**
 * Answer one WhatsApp message from a team member: into their latest main-chat
 * conversation (not a practice one), Mouse's turn as in the app chat, the
 * reply saved there and sent back. Anyone not on the team: nothing.
 */
export async function answerWhatsApp(m: { fromNumber: string; text: string; media: number }): Promise<void> {
  const people = await db.person.findMany({ where: { id: { in: TEAM_IDS }, active: true }, select: { id: true, name: true, role: true, phone: true } })
  const person = teamMemberFor(m.fromNumber, people)
  if (!person) return
  const to = normalizePhone(m.fromNumber)!
  if (!m.text.trim()) {
    if (m.media) await sendWhatsApp(to, 'Photos and files can\'t come through WhatsApp yet. Send them in the app chat, and tell me here what they are for.')
    else {
      // Never a silent drop: on 21 Oct 2026 Brandon's messages arrived empty
      // (the text was read from the wrong field) and nobody knew.
      const { logIssues } = await import('@/lib/mouse/issues')
      await logIssues('whatsapp', null, [{ kind: 'TURN_UNFINISHED', detail: `A WhatsApp message from ${person.name} arrived with no words Mouse could read, so it was not answered.` }])
      await sendWhatsApp(to, 'Your message reached me but I couldn\'t read any words in it. Could you send it again as text, or in the app chat?')
    }
    return
  }
  const { PRACTICE_TITLE } = await import('@/lib/mouse/practice')
  const last = await db.chatMessage.findFirst({
    // Most threads have no title; NOT on a null title would skip them all.
    where: { thread: { personId: person.id, OR: [{ title: null }, { title: { not: PRACTICE_TITLE } }] } },
    orderBy: { createdAt: 'desc' }, select: { threadId: true },
  })
  const threadId = last?.threadId ?? (await db.chatThread.create({ data: { personId: person.id } })).id
  await db.chatMessage.create({ data: { threadId, role: 'USER', content: m.text } })
  const { asPerson } = await import('@/lib/mouse/actor')
  const { chatTurn } = await import('@/lib/mouse/agent')
  const authored = `[${person.name}${person.role ? `, ${person.role}` : ''}] (Sent by WhatsApp; your reply goes back by WhatsApp, so keep it short.) ${m.text}`
  let reply: string
  try {
    const r = await asPerson(person.id, () => chatTurn(threadId, authored, undefined, 'chat'))
    reply = r.text || '(no reply)'
    await db.chatMessage.create({
      data: {
        threadId, role: 'ASSISTANT', content: reply,
        toolCallsJson: r.toolCalls.length ? (r.toolCalls as never) : undefined, model: r.model, agentUsageJson: r.usage as never,
      },
    })
  } catch (e) {
    console.error('[whatsapp] turn failed', e)
    reply = 'Something went wrong on my side answering that. It is saved in the app chat; try again there or here in a minute.'
  }
  for (const part of forWhatsApp(reply)) {
    const s = await sendWhatsApp(to, part)
    if (!s.ok) { console.error('[whatsapp] send failed', s.error); break }
  }
}
