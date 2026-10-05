import { NextResponse } from 'next/server'
import { lineSheetFileName } from '@/lib/line-sheet'
import { renderLineSheetXlsx } from '@/lib/line-sheet-xlsx'

export const maxDuration = 60

/**
 * The wholesale line sheet as an Excel file, the same rows as the PDF, drawn
 * now with today's prices (lib/line-sheet-xlsx.ts). Behind the login like
 * everything else; always a download, since a phone cannot preview it.
 */
export async function GET() {
  const xlsx = await renderLineSheetXlsx()
  if (!xlsx) return NextResponse.json({ error: 'The line sheet has no rows yet.' }, { status: 404 })
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${lineSheetFileName(new Date(), 'xlsx')}"`,
    },
  })
}
