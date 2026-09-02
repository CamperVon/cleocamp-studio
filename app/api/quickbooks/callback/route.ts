import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { completeConnection, snapshotPosition } from '@/lib/integrations/quickbooks'

export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const code = url.searchParams.get('code')
  const realmId = url.searchParams.get('realmId')
  const state = url.searchParams.get('state')

  const jar = await cookies()
  const expected = jar.get('qbo_state')?.value
  jar.delete('qbo_state')

  if (!state || !expected || state !== expected) {
    return NextResponse.json({ error: 'state mismatch — start again from Connect' }, { status: 400 })
  }
  if (!code || !realmId) {
    return NextResponse.json({ error: url.searchParams.get('error') ?? 'no code returned' }, { status: 400 })
  }

  try {
    await completeConnection(code, realmId)
    // Pull once immediately so there is something to look at rather than an
    // empty panel until the first nightly run.
    await snapshotPosition().catch(() => null)
    return NextResponse.redirect(new URL('/finances', url.origin))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
