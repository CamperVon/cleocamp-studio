import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'

/**
 * "Studio Mouse couldn't do this" — filed from chat, against the reply that
 * said so.
 *
 * Brandon, 9 Sept 2026: "I feel like this is a game of telephone." He was
 * right. When Mouse hit a wall he screenshotted it, retyped what it said, and
 * named the PO by hand — re-deriving context Mouse had already had in front of
 * it, into a session that started cold. This is the shortcut: one tap, and the
 * exchange plus the tools Mouse actually reached for are waiting for whoever
 * changes the code.
 *
 * It stores a POINTER, not a copy. entityId is the ChatMessage id; the thread
 * is read live when the report is opened, so anything said afterwards — a
 * correction, the real answer, a second attempt that worked — is there too. A
 * frozen transcript would have been the same telephone game, just automated.
 */
export async function POST(req: NextRequest) {
  const { messageId, note } = (await req.json()) as { messageId?: string; note?: string }
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })

  const message = await db.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, role: true, content: true },
  })
  if (!message) return NextResponse.json({ error: 'no such message' }, { status: 404 })

  // One report per message. Tapping twice on the same reply is a slip, not a
  // second gap, and two identical items in the list is exactly the noise this
  // is meant to cut.
  const existing = await db.actionItem.findFirst({
    where: { kind: 'GAP', entityType: 'CHAT_MESSAGE', entityId: message.id, resolved: false },
  })
  if (existing) return NextResponse.json({ ok: true, id: existing.id, alreadyReported: true })

  // The title is what someone scanning the list sees. Mouse's own words are
  // the most useful summary available — it is the sentence that said no.
  const firstLine = message.content.split('\n').find((l) => l.trim()) ?? 'Studio Mouse could not do something'
  const title = firstLine.length > 120 ? firstLine.slice(0, 117).trimEnd() + '…' : firstLine

  const item = await db.actionItem.create({
    data: {
      kind: 'GAP',
      entityType: 'CHAT_MESSAGE',
      entityId: message.id,
      title,
      detail: note?.trim() || null,
      source: 'CHAT',
      // A gap is not due on a date and should never nag as though it were.
      remindDaysBefore: null,
    },
    select: { id: true },
  })
  return NextResponse.json({ ok: true, id: item.id })
}
