import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * A photo the app holds itself, for a colour that is not on Shopify (12 Oct
 * 2026): a kept file, or a line sheet row's photo. Behind the sign-in like
 * every page; the PO PDF does not come here, it inlines the same bytes
 * (lib/variant-photos.ts).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { photoBytes } = await import('@/lib/variant-photos')
  const p = await photoBytes(id, db)
  if (!p) return NextResponse.json({ error: 'no such photo' }, { status: 404 })
  return new NextResponse(new Uint8Array(p.bytes), { headers: { 'content-type': p.mediaType, 'cache-control': 'private, max-age=86400' } })
}
