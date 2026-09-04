import { NextResponse } from 'next/server'
import { renderPurchaseOrderPdf } from '@/lib/po-pdf'

export const maxDuration = 60

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ poNumber: string }> },
) {
  const { poNumber } = await params
  const buffer = await renderPurchaseOrderPdf(poNumber)
  if (!buffer) return NextResponse.json({ error: 'no such purchase order' }, { status: 404 })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="PO-${poNumber}.pdf"`,
    },
  })
}
