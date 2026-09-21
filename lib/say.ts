import 'server-only'
import { db } from '@/lib/db'
import { secretsMatch } from '@/lib/say-core'

/**
 * Who is talking, when an update arrives from a phone.
 *
 * The app's own login is a single shared password and its session carries no
 * identity — `createSession` signs `{ ok: true }` and nothing else. That is
 * fine for a web page behind one door, and useless the moment an update can
 * arrive from Brandon's car, Cleo's kitchen or Jane's Tuesday. An update
 * without an author is worth much less than one with: half of what makes
 * "the cotton arrived" useful is knowing who saw it arrive.
 *
 * So each person who wants the Siri shortcut or the home-screen page gets
 * their own secret. It is the whole of the authentication on those doors, so
 * it is long, compared in constant time, and never logged or echoed back.
 */

export { mintSayToken, tokenFromRequest, spokenLine } from '@/lib/say-core'

/**
 * Resolve a token to a person, or to null.
 *
 * Prisma's `findUnique` on an indexed column is already the fast path, but a
 * plain lookup leaks a little through timing: a token that matches a row takes
 * a different path from one that does not. The comparison below re-checks the
 * value in constant time so a near-miss cannot be walked towards a hit one
 * character at a time. Belt and braces for a secret that is the entire lock.
 */
export async function personFromSayToken(
  token: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  const candidate = (token ?? '').trim()
  // Bound the work an unauthenticated caller can cause, and keep an absurd
  // string out of the query entirely.
  if (candidate.length < 32 || candidate.length > 512) return null

  const person = await db.person.findUnique({
    where: { sayToken: candidate },
    select: { id: true, name: true, active: true, sayToken: true },
  })
  if (!person?.sayToken || !person.active) return null

  if (!secretsMatch(person.sayToken, candidate)) return null

  return { id: person.id, name: person.name }
}

/**
 * The thread a person's dictated updates land in.
 *
 * One per person, reused forever, so Mouse has the continuity it has in chat
 * — "the cotton I mentioned" resolves against what they said last week — and
 * so the updates are readable in the app afterwards rather than scattered
 * across a thread per sentence.
 */
export async function threadForPerson(person: { id: string; name: string }): Promise<string> {
  const title = `${person.name} — dictated updates`
  const existing = await db.chatThread.findFirst({
    where: { title },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) return existing.id
  const made = await db.chatThread.create({ data: { title }, select: { id: true } })
  return made.id
}

