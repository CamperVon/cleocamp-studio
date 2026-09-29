import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { currentPersonId } from '@/lib/session'

/**
 * "Send this conversation to Brandon." Brandon, 29 Sept 2026: "if jane or
 * cleo needs to flag something, create a little box to send transcript to
 * brandon for troubleshooting."
 *
 * Emails him the conversation as it stands (their words, Mouse's replies and
 * which tools Mouse reached for, and whether each worked), with their note on
 * top, and files it on ToDo as a gap for Claude, the same as "Mouse can't do
 * this", so it is waiting for whoever fixes the code. Goes to his address on
 * file only; nothing leaves the team.
 */
const BRANDON = 'per_brandon'
const MAX_MESSAGES = 40

type ToolCall = { name?: string; status?: string; isWrite?: boolean }

const la = (d: Date) =>
  d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export async function POST(req: NextRequest) {
  const personId = await currentPersonId()
  const person = personId
    ? await db.person.findFirst({ where: { id: personId, active: true, external: false }, select: { name: true, email: true } })
    : null
  if (!person) return NextResponse.json({ error: 'Open the app from your own link to send this, so Brandon knows who it is from.' }, { status: 403 })

  const { threadId, note } = (await req.json()) as { threadId?: string; note?: string }
  if (!threadId) return NextResponse.json({ error: 'There is no conversation to send yet.' }, { status: 400 })

  const [brandon, rows] = await Promise.all([
    db.person.findUnique({ where: { id: BRANDON }, select: { email: true } }),
    db.chatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: MAX_MESSAGES,
      select: { id: true, role: true, content: true, toolCallsJson: true, createdAt: true },
    }),
  ])
  if (!brandon?.email) return NextResponse.json({ error: "Brandon's email is not on file." }, { status: 500 })
  if (!rows.length) return NextResponse.json({ error: 'There is no conversation to send yet.' }, { status: 400 })
  const messages = rows.reverse()
  const first = person.name.split(' ')[0]
  const said = note?.trim().slice(0, 2000) || null

  const transcript = messages.map((m) => {
    const who = m.role === 'USER' ? first : 'Mouse'
    const calls = Array.isArray(m.toolCallsJson) ? (m.toolCallsJson as ToolCall[]) : []
    const tools = calls.length
      ? `\n  [tools: ${calls.map((c) => `${c.name ?? '?'}${c.status && c.status !== 'succeeded' ? ` (${c.status})` : ''}`).join(', ')}]`
      : ''
    return `${la(m.createdAt)} · ${who}:\n${m.content.slice(0, 4000)}${tools}`
  }).join('\n\n')

  const sent = await sendEmail({
    to: [brandon.email],
    ...(person.email ? { replyTo: person.email } : {}),
    subject: `Mouse troubleshooting from ${first}${said ? `: ${said.split('\n')[0].slice(0, 70)}` : ''}`,
    text:
      `${first} sent you a Mouse conversation to look at.\n\n` +
      (said ? `${first}'s note:\n${said}\n\n` : `${first} didn't add a note.\n\n`) +
      `It is also on ToDo as something for Claude to fix.\n\n` +
      `---------- The conversation${rows.length === MAX_MESSAGES ? ` (last ${MAX_MESSAGES} messages)` : ''} ----------\n\n` +
      `${transcript}\n\n— Studio Mouse`,
  }).catch((e) => ({ sent: false as const, reason: String(e) }))
  if (!sent.sent) return NextResponse.json({ error: `The email did not go: ${'reason' in sent ? sent.reason : 'unknown error'}` }, { status: 502 })

  // On ToDo as a gap, pointing at the last message so the live thread is read
  // when it is picked up (see app/api/gap/route.ts).
  const last = messages[messages.length - 1]
  await db.actionItem.create({
    data: {
      kind: 'GAP', entityType: 'CHAT_MESSAGE', entityId: last.id, source: 'CHAT', remindDaysBefore: null,
      title: `${first} sent a Mouse conversation to Brandon${said ? `: ${said.split('\n')[0].slice(0, 80)}` : ''}`,
      detail: said,
    },
  }).catch((e) => console.error('[chat] troubleshooting gap not filed', e))

  return NextResponse.json({ ok: true })
}
