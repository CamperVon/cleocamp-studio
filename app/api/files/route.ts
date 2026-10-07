import { NextResponse } from 'next/server'
import { uploadFromForm } from '@/lib/files'

/**
 * Upload to the Files area. Multipart, so the bytes travel as they are (a
 * server action would cap them at 1 MB). Signed-in only, like every route
 * that proxy.ts does not exempt.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'No file came through.' }, { status: 400 })
  const r = await uploadFromForm(form)
  return r.ok ? NextResponse.json({ id: r.id }) : NextResponse.json({ error: r.error }, { status: 400 })
}
