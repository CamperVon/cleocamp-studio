import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const COOKIE = 'cleo_session'

/**
 * Everything is protected except /login and the cron route.
 *
 * The cron route is deliberately excluded because Vercel Cron cannot hold a
 * session cookie. It authenticates with CRON_SECRET instead, checked inside
 * the route itself — see SPEC.md §8.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  // Two routes cannot hold a session cookie and authenticate their own way:
  // the cron route with CRON_SECRET, and the inbound-email webhook with a
  // Svix signature from Resend.
  //
  // The "tell Mouse" doors are the third and fourth: a personal token
  // identifies the speaker, checked inside the route on every send. They have
  // to be out here, because the whole point is that someone in a car can talk
  // to Mouse without stopping to type a shared password — sending them to a
  // login screen first would reinstate the exact friction they exist to
  // remove. Matched EXACTLY, not by prefix: /api/say-links mints these tokens
  // and must stay behind the password like everything else.
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/inbound') ||
    // Telnyx's webhook: it only stores messages, and checks Telnyx's signature
    // once TELNYX_PUBLIC_KEY is set (app/api/telnyx/route.ts).
    pathname === '/api/telnyx' ||
    pathname.startsWith('/api/finances') ||
    // Muse, the team's outside researcher: its own key, checked in each
    // route (app/api/muse/_auth.ts). Off entirely until MUSE_API_KEY is set.
    pathname.startsWith('/api/muse/') ||
    pathname === '/say' ||
    pathname === '/api/say' ||
    // Trading a personal link for a session cannot itself require a session.
    pathname === '/enter' ||
    pathname === '/manifest.webmanifest' ||
    // The read-only Claude connector (lib/mcp/): its endpoint takes an OAuth
    // bearer token, checked in the route; the metadata, registration and
    // token endpoints are public by the OAuth spec and grant nothing alone.
    // The consent page checks the session itself, so that a sign-in can
    // return to it with the whole request (this redirect keeps only the path).
    pathname === '/api/mcp' ||
    pathname.startsWith('/.well-known/oauth-') ||
    pathname === '/api/oauth/register' ||
    pathname === '/api/oauth/token' ||
    pathname === '/oauth/authorize' ||
    // Echoes back only the key it is given; see the route.
    pathname === '/api/manifest'
  ) {
    return NextResponse.next()
  }

  // The phone's home-screen icon opens /?k=<their key>. An installed web app
  // on iPhone does not always share Safari's cookies, so the key in the
  // address is what signs them in: through /enter, once, unless the session
  // already knows who they are.
  const key = pathname === '/' ? req.nextUrl.searchParams.get('k') : null
  const token = req.cookies.get(COOKIE)?.value
  if (token) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET))
      if (!key || payload.sub) return NextResponse.next()
    } catch {
      // fall through
    }
  }
  if (key) {
    const url = req.nextUrl.clone()
    url.pathname = '/enter'
    url.search = `?k=${encodeURIComponent(key)}&to=app`
    return NextResponse.redirect(url)
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
