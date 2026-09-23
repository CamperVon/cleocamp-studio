import { NextResponse } from 'next/server'
import { renderPurchaseOrderPdf } from '@/lib/po-pdf'

export const maxDuration = 60

export async function GET(
  req: Request,
  { params }: { params: Promise<{ poNumber: string }> },
) {
  const { poNumber } = await params
  const buffer = await renderPurchaseOrderPdf(poNumber)
  if (!buffer) return NextResponse.json({ error: 'no such purchase order' }, { status: 404 })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      // ?inline=1 shows it in the browser's own viewer instead of forcing a
      // download — the phone's share sheet and viewer need it that way. See
      // ../pdf-button.tsx.
      'Content-Disposition': `${new URL(req.url).searchParams.get('inline') ? 'inline' : 'attachment'}; filename="PO-${poNumber}.pdf"`,
    },
  })
}
