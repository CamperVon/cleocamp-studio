import { db } from '@/lib/db'
import { OAuthError, registerClient } from '@/lib/mcp/oauth'

// RFC 7591 dynamic client registration for the Claude connector. Open, as the
// spec requires, but it grants nothing: only Claude's own callback can be
// registered, and a person signed in to the app must still approve.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    return Response.json(await registerClient(db, body), { status: 201, headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    if (e instanceof OAuthError) return Response.json(e.body(), { status: e.status })
    console.error('[oauth] register failed', e)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
