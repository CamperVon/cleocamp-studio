import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ourCosts, settleTeamAnswers, taskForMuse } from '@/lib/muse'
import { BASE, denied } from '../../_auth'

/** GET /api/muse/tasks/{id} — the brief, its files and the questions so far. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req)
  if (no) return no
  const { id } = await params
  const found = await db.museTask.findUnique({ where: { id }, include: { questions: { orderBy: { createdAt: 'asc' } } } })
  if (!found || found.status === 'CANCELLED') return NextResponse.json({ error: 'No such task.' }, { status: 404 })
  const t = await settleTeamAnswers(found)
  if (!t.pickedUpAt) await db.museTask.update({ where: { id }, data: { pickedUpAt: new Date() } })
  const [files, costs] = await Promise.all([
    t.fileIds.length
      ? db.storedFile.findMany({ where: { id: { in: t.fileIds } }, select: { id: true, title: true, mediaType: true, sizeBytes: true } })
      : [],
    ourCosts(t.records),
  ])
  return NextResponse.json(taskForMuse(t, files, BASE, costs))
}
