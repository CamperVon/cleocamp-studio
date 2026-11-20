import { SignJWT, type JWTPayload } from 'jose'

/**
 * The session cookie, shared by lib/session.ts and the proxy (which cannot
 * import server-only code). Edge-safe: jose only.
 *
 * Sliding since 20 Nov 2026. Brandon: "cleo and jane keep having to reset
 * their link / password every so often. can we stop that from happening?"
 * The session used to last a fixed 30 days from the moment of signing in, so
 * however much someone used the app, on day 31 they were sent to the login
 * page and had to find their link or the password again. Now any visit after
 * a day renews it for the full period, so only six months of not opening the
 * app at all signs anyone out. A personal link never expires on its own; only
 * replacing it on the links page does.
 */
export const COOKIE = 'cleo_session'
export const MAX_AGE = 60 * 60 * 24 * 180 // 180 days, renewed on use
/** Renew at most once a day, so a page full of requests does not re-sign every one. */
export const RENEW_AFTER = 60 * 60 * 24

export const sessionSecret = () => new TextEncoder().encode(process.env.SESSION_SECRET)

/** Sign a session for the claims given (a person's id as sub, or none). */
export async function signSession(personId?: string): Promise<string> {
  return new SignJWT(personId ? { ok: true, sub: personId } : { ok: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(sessionSecret())
}

/** Is a valid session old enough to renew? Pure: `now` in seconds. */
export function shouldRenew(payload: Pick<JWTPayload, 'iat'>, now = Math.floor(Date.now() / 1000)): boolean {
  return typeof payload.iat !== 'number' || now - payload.iat >= RENEW_AFTER
}

export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE,
})
