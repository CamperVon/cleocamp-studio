import { NextResponse } from 'next/server'
import { keepFile } from '@/lib/files'

/**
 * Upload to the Files area. Multipart, so the bytes travel as they are (a
 * server action would cap them at 1 MB). Signed-in only, like every route
 * that proxy.ts does not exempt.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) return NextResponse.json({ error: 'No file came through.' }, { status: 400 })
  let links: Array<{ kind: string; recordId: string }> = []
  try { links = JSON.parse(String(form.get('links') ?? '[]')) } catch { return NextResponse.json({ error: 'The links were unreadable.' }, { status: 400 }) }
  const r = await keepFile({
    title: String(form.get('title') ?? '') || file.name.replace(/\.[a-z0-9]+$/i, ''),
    filename: file.name,
    mediaType: file.type,
    base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    notes: String(form.get('notes') ?? ''),
    links,
  })
  return r.ok ? NextResponse.json({ id: r.id }) : NextResponse.json({ error: r.error }, { status: 400 })
}
