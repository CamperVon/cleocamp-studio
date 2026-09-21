import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

const COOKIE = 'cleo_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days — Cleo shouldn't be logged out weekly

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET)

/**
 * Start a session, optionally as a named person.
 *
 * The password door signs nobody: one shared password cannot tell Cleo from
 * Jane, and pretending otherwise would put a confident wrong name on a note.
 * A personal link signs the person it belongs to, so from then on every note,
 * todo and count carries an author instead of being written by the building.
 *
 * Brandon, 21 Sept 2026, on wanting this without a sign-in screen. He is
 * right that it has to be without one — a password typed in a car is the
 * friction, not the security.
 */
export async function createSession(personId?: string) {
  const token = await new SignJWT(personId ? { ok: true, sub: personId } : { ok: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret())

  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function destroySession() {
  const jar = await cookies()
  jar.delete(COOKIE)
}

export async function isSignedIn() {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return false
  try {
    await jwtVerify(token, secret())
    return true
  } catch {
    return false
  }
}

/**
 * Who is using the app right now, if anybody says so.
 *
 * Null is an ordinary answer, not a failure: somebody who signed in with the
 * shared password is genuinely anonymous, and everything keeps working for
 * them exactly as it did. Nothing should refuse to run for want of a name.
 */
export async function currentPersonId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
  } catch {
    return null
  }
}

/** Timing-safe-ish comparison so the password can't be probed by response time. */
export function passwordMatches(input: string) {
  const expected = process.env.ADMIN_PASSWORD ?? ''
  if (!expected) return false
  if (input.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export { COOKIE }
