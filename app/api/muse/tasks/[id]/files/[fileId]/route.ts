import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { denied } from '../../../../_auth'

/** GET a file sent with a task. Only files attached to that task, never anything else in Files. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const no = denied(req)
  if (no) return no
  const { id, fileId } = await params
  const t = await db.museTask.findUnique({ where: { id }, select: { fileIds: true, status: true } })
  if (!t || t.status === 'CANCELLED' || !t.fileIds.includes(fileId)) return NextResponse.json({ error: 'No such file on this task.' }, { status: 404 })
  const f = await db.storedFile.findUnique({ where: { id: fileId }, select: { filename: true, mediaType: true, data: true } })
  if (!f) return NextResponse.json({ error: 'No such file on this task.' }, { status: 404 })
  return new NextResponse(new Uint8Array(Buffer.from(f.data, 'base64')), {
    headers: { 'content-type': f.mediaType, 'content-disposition': `inline; filename="${f.filename.replace(/[^\w.\- ]/g, '_')}"`, 'cache-control': 'private, no-store' },
  })
}
