import { db } from '@/lib/db'

/** A kept file, opened in the browser. Signed-in only (proxy.ts). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const f = await db.storedFile.findUnique({ where: { id }, select: { filename: true, mediaType: true, data: true } })
  if (!f) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(Buffer.from(f.data, 'base64')), {
    headers: {
      'Content-Type': f.mediaType,
      'Content-Disposition': `inline; filename="${f.filename.replace(/["\\\r\n]/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
