import { NextResponse, type NextRequest } from 'next/server'
import { personFromSayToken } from '@/lib/say'
import { createSession } from '@/lib/session'

/**
 * Trade a personal link for a session, as the person it belongs to.
 *
 * This is the whole of "signing in" for Cleo, Jane and Brandon: open your own
 * link once on a phone and the app knows you from then on, with nothing typed.
 * The shared password still works and still signs nobody, so anyone without a
 * link is exactly as they were.
 *
 * What it buys is an author. Until now the session signed `{ ok: true }` and
 * nothing else, so every note, todo and count was written by the building
 * rather than by a person, and Mouse answering "who is chasing Michael" had
 * nothing to answer from.
 *
 * It then forwards to the dictate page carrying the token, which that page
 * stores locally and strips from the address bar — so one link sets up both
 * doors and there is nothing else to send anybody.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('k') ?? ''
  const person = await personFromSayToken(token)

  if (!person) {
    // Nothing about why. An expired link and an invented one look the same.
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = '?stale=1'
    return NextResponse.redirect(url)
  }

  await createSession(person.id)

  const url = req.nextUrl.clone()

  // Where the link lands depends on what it is for, because the two uses want
  // opposite things.
  //
  // A phone link goes to the dictate page AND keeps the token in the address,
  // because Add to Home Screen saves the address and that is the only thing
  // identifying the icon afterwards.
  //
  // A desktop link goes to the app itself and drops the token, because the
  // session cookie now carries the identity and there is nothing to install.
  // Leaving a secret in a desktop address bar would only put it in history and
  // in whatever the browser syncs, for nothing.
  // Since 30 Sept 2026 the phone opens the full app, not Say Cheese (Jane and
  // Cleo would rather have everything on their phones). Old Say Cheese links
  // say to=say and land in the same place. The key stays in the address for
  // the same reason it always did: see app/api/manifest/route.ts.
  const to = req.nextUrl.searchParams.get('to')
  if (to === 'app' || to === 'say') {
    url.pathname = '/'
    url.search = `?k=${encodeURIComponent(token)}`
  } else {
    url.pathname = '/'
    url.search = ''
  }
  return NextResponse.redirect(url)
}
