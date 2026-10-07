import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { checkReport, recordReport } from '@/lib/muse'
import { denied } from '../../../_auth'

/** POST /api/muse/tasks/{id}/report — Muse's findings. Posting again replaces them. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const no = denied(req)
  if (no) return no
  const { id } = await params
  const t = await db.museTask.findUnique({ where: { id }, select: { status: true } })
  if (!t || t.status === 'CANCELLED') return NextResponse.json({ error: 'No such task.' }, { status: 404 })
  if (t.status === 'CLOSED') return NextResponse.json({ error: 'This task is closed.' }, { status: 409 })
  const body = await req.json().catch(() => null)
  const r = checkReport(body)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  await recordReport(id, r)
  return NextResponse.json({ ok: true, status: 'reported' })
}
