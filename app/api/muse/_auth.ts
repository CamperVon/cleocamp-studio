import { NextResponse, type NextRequest } from 'next/server'
import { museAuthorized, museKey } from '@/lib/muse'

/** The Muse API answers only Muse's key. With no usable key set, it is off and says why. */
export function denied(req: NextRequest): NextResponse | null {
  const key = museKey()
  if (!key) return NextResponse.json({ error: 'The Muse API is switched off.' }, { status: 503 })
  // Said plainly rather than as a 401 Muse can never get past: a short key
  // set in Vercel is a setup mistake on our side, not a wrong key on Muse's.
  if (key.length < 32) return NextResponse.json({ error: 'The Muse API key set on our side is too short (under 32 characters). The team needs to set a longer one.' }, { status: 503 })
  return museAuthorized(req.headers.get('authorization'), key, req.headers.get('x-api-key'))
    ? null
    : NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

/** The app's own address, for links Muse follows. */
export const BASE = 'https://admin.cleocamp.com'
