import { NextResponse } from 'next/server'
import { renderDraftPdf } from '@/lib/draft-pdf'

export const maxDuration = 60

/**
 * A Shopify draft order as a PDF, behind the login like everything else, so
 * a link to it can go round the studio (see lib/draft-pdf.tsx). Opens in the
 * browser's own viewer, which can save or share it on a phone as well as a
 * desktop; ?download=1 forces a download instead.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await renderDraftPdf(id)
  if (!r) return NextResponse.json({ error: 'no such draft order' }, { status: 404 })
  const file = `Draft-${r.name.replace(/[^A-Za-z0-9]/g, '')}.pdf`
  return new NextResponse(new Uint8Array(r.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${new URL(req.url).searchParams.get('download') ? 'attachment' : 'inline'}; filename="${file}"`,
    },
  })
}
