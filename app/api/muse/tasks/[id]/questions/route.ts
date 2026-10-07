import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { answerMuse, checkQuestion, LIMITS } from '@/lib/muse'
import { laMidnight } from '@/lib/dates'
import { denied } from '../../../_auth'

// Mouse answers in the same request; give it room.
export const maxDuration = 300

/** POST /api/muse/tasks/{id}/questions {"question"} — answered now, or pending with the team. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req)
  if (no) return no
  const { id } = await params
  const t = await db.museTask.findUnique({ where: { id }, select: { status: true, _count: { select: { questions: true } } } })
  if (!t || t.status === 'CANCELLED') return NextResponse.json({ error: 'No such task.' }, { status: 404 })
  if (t.status === 'CLOSED') return NextResponse.json({ error: 'This task is closed.' }, { status: 409 })
  const body = await req.json().catch(() => null)
  const q = checkQuestion(body)
  if ('error' in q) return NextResponse.json({ error: q.error }, { status: 400 })
  if (t._count.questions >= LIMITS.questionsPerTask) return NextResponse.json({ error: `At most ${LIMITS.questionsPerTask} questions on one task. Post the report with what you have, and say what is still open.` }, { status: 429 })
  const today = await db.museQuestion.count({ where: { createdAt: { gte: laMidnight(0) } } })
  if (today >= LIMITS.questionsPerDay) return NextResponse.json({ error: 'Too many questions today. Try again tomorrow.' }, { status: 429 })
  const r = await answerMuse(id, q.question)
  return NextResponse.json({
    id: r.id, status: r.status, answer: r.answer,
    ...(r.status === 'pending' ? { note: 'Mouse has put this to the team. The answer will be on the task when you next fetch it.' } : {}),
  })
}
