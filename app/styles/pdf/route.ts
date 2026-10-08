import { NextResponse } from 'next/server'
import { renderStyleReferencePdf } from '@/lib/style-reference-pdf'

export const maxDuration = 60

/** The style number reference as a PDF. Signed-in only, like every route proxy.ts does not exempt. */
export async function GET(req: Request) {
  const buffer = await renderStyleReferencePdf()
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
      'Content-Disposition': `${new URL(req.url).searchParams.get('inline') ? 'inline' : 'attachment'}; filename="Cleo-Camp-style-numbers.pdf"`,
    },
  })
}
