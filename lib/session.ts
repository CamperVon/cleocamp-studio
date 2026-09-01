import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

const COOKIE = 'cleo_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days — Cleo shouldn't be logged out weekly

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET)

export async function createSession() {
  const token = await new SignJWT({ ok: true })
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
