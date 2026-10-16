import { db } from '@/lib/db'
import { OAuthError, tokenRequest } from '@/lib/mcp/oauth'

// The Claude connector's token endpoint: authorization code (with PKCE) or refresh token.
export async function POST(req: Request) {
  const headers = { 'cache-control': 'no-store', pragma: 'no-cache' }
  try {
    // Form-encoded, as OAuth specifies; a JSON body is read the same way.
    const raw = await req.text()
    const json = (req.headers.get('content-type') ?? '').includes('application/json')
    const form = json ? new URLSearchParams(Object.entries(JSON.parse(raw || '{}') as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : new URLSearchParams(raw)
    return Response.json(await tokenRequest(db, form, req.headers.get('authorization'), new URL(req.url).origin), { headers })
  } catch (e) {
    if (e instanceof OAuthError) return Response.json(e.body(), { status: e.status, headers })
    console.error('[oauth] token failed', e)
    return Response.json({ error: 'server_error' }, { status: 500, headers })
  }
}
