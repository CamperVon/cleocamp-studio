import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { chatTurn } from '@/lib/mouse/agent'

export const maxDuration = 300

type InAttachment = { filename: string; mediaType: string; base64: string }

// Claude reads images natively and PDFs as documents — nothing else. Vercel's
// own function payload limit (4.5MB, fixed on Hobby) would reject anything
// much bigger than this before it even reached us, but that lands as an
// opaque 413. Checking here first means a message the person can act on.
const ALLOWED_TYPES = /^(application\/pdf|image\/(jpeg|png|webp))$/
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
const MAX_ATTACHMENTS = 3

// Lets the client pick a conversation back up after navigating away or
// refreshing — every turn is already persisted, the UI just never reloaded
// it. Returns messages in the same shape the client renders, oldest first.
export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get('threadId')
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 })

  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { attachments: { select: { filename: true } } },
      },
    },
  })
  if (!thread) return NextResponse.json({ error: 'no such thread' }, { status: 404 })

  return NextResponse.json({
    threadId: thread.id,
    messages: thread.messages.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      text: m.content,
      model: m.model ?? undefined,
      attachments: m.attachments.length ? m.attachments : undefined,
      // toolCallsJson is every call made that turn, {name, input}[]. The
      // "write" badges only ever show the ones chatTurn itself treats as a
      // write — the same two lookup tools excluded there. No summary is
      // stored, but the badge never showed it, only the tool name.
      writes: Array.isArray(m.toolCallsJson)
        ? (m.toolCallsJson as Array<{ name: string }>)
            .filter((c) => c.name !== 'query_status' && c.name !== 'request_deep_analysis')
            .map((c) => ({ tool: c.name, summary: '' }))
        : undefined,
    })),
  })
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    threadId?: string
    message: string
    attachments?: InAttachment[]
  }
  const message = body.message ?? ''
  const attachments = body.attachments ?? []

  if (!message.trim() && attachments.length === 0) {
    return NextResponse.json({ error: 'empty message' }, { status: 400 })
  }
  if (attachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: `send at most ${MAX_ATTACHMENTS} files at a time` }, { status: 400 })
  }
  for (const a of attachments) {
    if (!ALLOWED_TYPES.test(a.mediaType)) {
      return NextResponse.json(
        { error: `can't read ${a.filename || 'that file'} — send a PDF, JPG, PNG or WEBP` },
        { status: 400 },
      )
    }
    if (Buffer.byteLength(a.base64, 'base64') > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `${a.filename || 'that file'} is too big — keep attachments under 4MB` },
        { status: 400 },
      )
    }
  }

  const thread = body.threadId
    ? await db.chatThread.findUnique({ where: { id: body.threadId } })
    : await db.chatThread.create({ data: {} })
  if (!thread) return NextResponse.json({ error: 'no such thread' }, { status: 404 })

  // A photo of an invoice with no caption still needs an instruction — tell
  // Studio Mouse to look at it rather than sending it an empty message.
  const instruction = message.trim() || "Here's a document — take a look."

  await db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'USER',
      content: instruction,
      attachments: attachments.length
        ? {
            create: attachments.map((a) => ({
              filename: a.filename || 'attachment',
              mediaType: a.mediaType,
              data: a.base64,
              sizeBytes: Buffer.byteLength(a.base64, 'base64'),
            })),
          }
        : undefined,
    },
  })

  const r = await chatTurn(
    thread.id,
    instruction,
    attachments.map((a) => ({ mediaType: a.mediaType, base64: a.base64, filename: a.filename })),
  )

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
