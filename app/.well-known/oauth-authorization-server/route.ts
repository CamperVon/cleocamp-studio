import { authorizationServerMetadata } from '@/lib/mcp/oauth'

// RFC 8414: the connector's sign-in endpoints. Public by design.
export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(new URL(req.url).origin), { headers: { 'cache-control': 'public, max-age=300' } })
}
