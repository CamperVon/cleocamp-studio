import { NextResponse } from 'next/server'
import { lineSheetFileName, renderLineSheetPdf } from '@/lib/line-sheet'

export const maxDuration = 60

/**
 * The wholesale line sheet as a PDF, drawn now with today's prices (see
 * lib/line-sheet.tsx). Behind the login like everything else; opens in the
 * browser's viewer, ?download=1 to save it.
 */
export async function GET(req: Request) {
  const pdf = await renderLineSheetPdf()
  if (!pdf) return NextResponse.json({ error: 'The line sheet has no rows yet.' }, { status: 404 })
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${new URL(req.url).searchParams.get('download') ? 'attachment' : 'inline'}; filename="${lineSheetFileName()}"`,
    },
  })
}
