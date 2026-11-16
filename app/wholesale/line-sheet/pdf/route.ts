import { NextResponse } from 'next/server'
import { lineSheetFileName, renderLineSheetPdf, sheetForOf } from '@/lib/line-sheet'

export const maxDuration = 60

/**
 * The wholesale line sheet as a PDF, drawn now with today's prices (see
 * lib/line-sheet.tsx). Behind the login like everything else; opens in the
 * browser's viewer, ?download=1 to save it.
 */
export async function GET(req: Request) {
  // ?for=stylists: the same rows with no prices and bigger photos (15 Nov 2026).
  const sheetFor = sheetForOf(new URL(req.url).searchParams.get('for'))
  const pdf = await renderLineSheetPdf(new Date(), sheetFor)
  if (!pdf) return NextResponse.json({ error: 'The line sheet has no rows yet.' }, { status: 404 })
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      // Drawn fresh each time; a phone must not show yesterday's copy.
      'Cache-Control': 'no-store',
      'Content-Disposition': `${new URL(req.url).searchParams.get('download') ? 'attachment' : 'inline'}; filename="${lineSheetFileName(new Date(), 'pdf', sheetFor)}"`,
    },
  })
}
