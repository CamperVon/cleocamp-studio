import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authorizeUrl, isConfigured } from '@/lib/integrations/quickbooks'

/** Starts the one-time authorisation. Behind the password like everything else. */
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Set QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI first.' },
      { status: 503 },
    )
  }
  // A random state, stored in a short-lived cookie and checked on the way back,
  // so a link someone else crafts cannot bind their books to this app.
  const state = crypto.randomUUID()
  const jar = await cookies()
  jar.set('qbo_state', state, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: 600,
  })
  return NextResponse.redirect(authorizeUrl(state))
}
