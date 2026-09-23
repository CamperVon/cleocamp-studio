import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'
import { NavBar } from './nav-bar'

export async function Nav() {
  // Who the app thinks you are, shown because the answer changes what gets
  // written down. Signed in with the shared password you are nobody in
  // particular and everything still works; opened from your own link you are
  // Cleo, and your name goes on what you record. Silent about it either way
  // would leave people guessing which one they are.
  const personId = await currentPersonId()
  const person = personId
    ? await db.person.findUnique({ where: { id: personId }, select: { name: true } })
    : null

  return <NavBar personName={person?.name ?? null} />
}
