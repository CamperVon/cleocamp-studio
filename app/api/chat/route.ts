import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { chatTurn } from '@/lib/mouse/agent'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { threadId, message } = (await req.json()) as { threadId?: string; message: string }
  if (!message?.trim()) return NextResponse.json({ error: 'empty message' }, { status: 400 })

  const thread = threadId
    ? await db.chatThread.findUnique({ where: { id: threadId } })
    : await db.chatThread.create({ data: {} })
  if (!thread) return NextResponse.json({ error: 'no such thread' }, { status: 404 })

  await db.chatMessage.create({ data: { threadId: thread.id, role: 'USER', content: message } })

  const r = await chatTurn(thread.id, message)

  await db.chatMessage.create({
    data: {
      threadId: thread.id, role: 'ASSISTANT',
      content: r.text || '(no reply)',
      toolCallsJson: r.toolCalls.length ? (r.toolCalls as never) : undefined,
      model: r.model,
    },
  })

  return NextResponse.json({
    threadId: thread.id,
    reply: r.text,
    writes: r.writes,
    model: r.model,
    escalated: r.escalated,
  })
}
