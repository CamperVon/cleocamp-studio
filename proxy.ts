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
  if (pathname.startsWith('/login') || pathname.startsWith('/api/cron')) {
    return NextResponse.next()
  }

  const token = req.cookies.get(COOKIE)?.value
  if (token) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET))
      return NextResponse.next()
    } catch {
      // fall through to the redirect
    }
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
