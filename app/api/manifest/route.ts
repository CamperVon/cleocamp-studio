import { NextResponse, type NextRequest } from 'next/server'
import manifest from '@/app/manifest'

/**
 * The app's manifest with a person's key in start_url, for the full app on
 * their phone (Jane and Cleo, 30 Sept 2026: "they would rather just have the
 * full app on their phones, not the Say cheese mini app").
 *
 * iPhone opens an installed web app at the manifest's start_url, not at the
 * address it was added from (learned on Say Cheese, see app/say history), and
 * the installed app does not always share Safari's sign-in. With "/" there,
 * the icon opened a login screen that could not tell Jane from anyone. So the
 * home page, when opened from a personal link, points at this copy instead,
 * and the icon opens /?k=<key>, which signs them in (proxy.ts, /enter).
 *
 * Public, like /enter: it hands back only the key it was given, and a key
 * that is not well formed is dropped.
 */
export function GET(req: NextRequest) {
  const k = req.nextUrl.searchParams.get('k') ?? ''
  const base = manifest()
  const body = /^[A-Za-z0-9_-]{20,100}$/.test(k) ? { ...base, start_url: `/?k=${k}` } : base
  return NextResponse.json(body, { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' } })
}
