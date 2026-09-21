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
  url.pathname = '/say'
  url.search = `?k=${encodeURIComponent(token)}`
  return NextResponse.redirect(url)
}
