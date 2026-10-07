import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { denied } from '../_auth'

/** GET /api/muse/tasks?status=open — what Mouse has handed Muse. Read-only. */
export async function GET(req: NextRequest) {
  const no = denied(req)
  if (no) return no
  const status = (req.nextUrl.searchParams.get('status') ?? 'open').toLowerCase()
  const where = status === 'all' ? { status: { in: ['OPEN', 'REPORTED'] } } : status === 'reported' ? { status: 'REPORTED' } : { status: 'OPEN' }
  const tasks = await db.museTask.findMany({
    where, orderBy: { createdAt: 'asc' }, take: 50,
    select: { id: true, number: true, title: true, status: true, createdAt: true, reportedAt: true, questions: { select: { status: true } } },
  })
  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id, number: t.number, title: t.title, status: t.status.toLowerCase(), createdAt: t.createdAt.toISOString(),
      reported: !!t.reportedAt, questions: t.questions.length, pendingQuestions: t.questions.filter((q) => q.status !== 'ANSWERED').length,
    })),
  })
}
