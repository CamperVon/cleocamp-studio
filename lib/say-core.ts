import { timingSafeEqual, randomBytes } from 'node:crypto'

/**
 * The parts of the "tell Mouse" doors that touch no database and no request
 * context: minting a secret, finding one on an incoming request, and cutting a
 * reply down to something worth hearing at a traffic light.
 *
 * Separate from lib/say.ts so they can be tested directly. That file is
 * `server-only` and reaches for the database, which a test runner cannot load,
 * and these three are the parts where a mistake is quiet — a token that is not
 * random enough, a header that is read in the wrong order, a spoken line that
 * runs for a paragraph.
 */

/** 32 bytes of randomness, url-safe, so it can live in a link or a header. */
export function mintSayToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Pull the token off a request.
 *
 * Header first, because that is what the Siri shortcut sends and headers do
 * not end up in server logs or browser history the way a query string does.
 * The `k` parameter exists for one purpose: the install link a person opens
 * once, which the page immediately strips and stores. Nothing should keep
 * calling with it.
 */
export function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? ''
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)
  if (bearer) return bearer[1].trim()
  const header = req.headers.get('x-say-token')
  if (header) return header.trim()
  try {
    return new URL(req.url).searchParams.get('k')
  } catch {
    return null
  }
}

/**
 * Trim Mouse's reply to something worth hearing at a traffic light.
 *
 * The full reply is kept on the thread and readable later; this is only what
 * comes back through the door. Spoken aloud by Siri or shown on the page, so
 * it wants to be one or two sentences and no markdown.
 */
export function spokenLine(reply: string): string {
  const flat = reply
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return 'Got it.'
  const sentences = flat.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [flat]
  // Each captured sentence keeps the space that preceded it, so trim before
  // joining or the line comes back with a double space in the middle of it.
  const out = sentences.slice(0, 2).map((x) => x.trim()).join(' ').trim()
  return out.length > 320 ? `${out.slice(0, 317).trimEnd()}...` : out
}

/** Constant-time string equality, for comparing a secret to a stored one. */
export function secretsMatch(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
