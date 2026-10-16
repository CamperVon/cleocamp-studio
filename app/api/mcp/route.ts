import { db } from '@/lib/db'
import { unauthorized, verifyAccess } from '@/lib/mcp/oauth'
import { shopifyLiveStock } from '@/lib/mcp/live-stock'
import { handleMcp } from '@/lib/mcp/server'

// The read-only Claude connector (lib/mcp/server.ts). Outside the app's
// session check in proxy.ts: it takes an OAuth bearer token instead.
export const maxDuration = 60

const origin = (req: Request) => new URL(req.url).origin

export async function POST(req: Request) {
  return handleMcp(req, { db, origin: origin(req), liveStock: shopifyLiveStock })
}

// Stateless JSON only: no stream to open, no session to end. Without a token
// it still answers 401, so a client probing here is pointed at sign-in.
async function notHere(req: Request) {
  if (!(await verifyAccess(db, req.headers.get('authorization'), origin(req)))) return unauthorized(origin(req))
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { allow: 'POST', 'content-type': 'application/json' } })
}
export const GET = notHere
export const DELETE = notHere
