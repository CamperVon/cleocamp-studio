import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ poNumber: string; exportId: string }> }) {
  const { poNumber, exportId } = await params
  const copy = await db.purchaseOrderExport.findFirst({
    where: { id: exportId, purchaseOrder: { poNumber } },
  })
  if (!copy) return NextResponse.json({ error: 'No such saved copy' }, { status: 404 })
  const safeNumber = poNumber.replace(/[^a-zA-Z0-9_-]/g, '_')
  return new NextResponse(new Uint8Array(copy.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="PO-${safeNumber}-${copy.language}-${copy.id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
