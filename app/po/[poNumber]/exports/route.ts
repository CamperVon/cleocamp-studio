import { NextResponse } from 'next/server'
import { exportPurchaseOrder } from '@/lib/po-export'

export const maxDuration = 60

// POST because preparing an immutable copy writes a record. Never from a GET
// or a prefetched link. Session authentication is enforced by proxy.ts.
export async function POST(req: Request, { params }: { params: Promise<{ poNumber: string }> }) {
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(req.url).origin) {
    return NextResponse.json({ error: 'Please prepare the copy from the studio app.' }, { status: 403 })
  }
  const { poNumber } = await params
  try {
    return NextResponse.json(await exportPurchaseOrder(poNumber))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 })
  }
}
