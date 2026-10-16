import { protectedResourceMetadata } from '@/lib/mcp/oauth'

// RFC 9728: where the connector's tokens come from. Public by design.
export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(new URL(req.url).origin), { headers: { 'cache-control': 'public, max-age=300' } })
}
