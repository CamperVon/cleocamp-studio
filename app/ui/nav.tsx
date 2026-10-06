import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'
import { NavBar } from './nav-bar'
import { isPressing } from '@/lib/pressing'

export async function Nav() {
  // Who the app thinks you are, shown because the answer changes what gets
  // written down. Signed in with the shared password you are nobody in
  // particular and everything still works; opened from your own link you are
  // Cleo, and your name goes on what you record. Silent about it either way
  // would leave people guessing which one they are.
  const personId = await currentPersonId()
  // Counts on the tabs (6 Oct 2026), so a glance at the bar says whether a
  // page needs you before you open it. ToDo counts what is pressing (urgent,
  // due or overdue: lib/pressing.ts), not everything open: 50 open items on the badge was wallpaper.
  // Support counts pressing cases only, as Home does.
  const [person, todo, support] = await Promise.all([
    personId ? db.person.findUnique({ where: { id: personId }, select: { name: true } }) : null,
    db.actionItem.findMany({ where: { resolved: false, kind: { in: ['QUESTION', 'TODO'] }, OR: [{ urgent: true }, { dueDate: { not: null } }] }, select: { urgent: true, dueDate: true, remindDaysBefore: true } }).then((xs) => xs.filter((x) => isPressing(x)).length).catch(() => 0),
    db.supportCase.count({ where: { status: 'OPEN', category: { not: 'SPAM' }, urgency: 'NOW' } }).catch(() => 0),
  ])

  return <NavBar personName={person?.name ?? null} counts={{ '/items': todo, '/support': support }} />
}
