import { NextResponse, type NextRequest } from 'next/server'
import { museAuthorized } from '@/lib/muse'

/** The Muse API answers only Muse's key. With no key set, it is off. */
export function denied(req: NextRequest): NextResponse | null {
  if (!process.env.MUSE_API_KEY) return NextResponse.json({ error: 'The Muse API is switched off.' }, { status: 503 })
  return museAuthorized(req.headers.get('authorization')) ? null : NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

/** The app's own address, for links Muse follows. */
export const BASE = 'https://admin.cleocamp.com'
