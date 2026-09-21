import Link from 'next/link'
import { signOut } from '@/app/login/actions'
import { Wordmark } from './wordmark'
import { db } from '@/lib/db'
import { currentPersonId } from '@/lib/session'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/components', label: 'Components' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/purchase-orders', label: 'Purchase orders' },
  { href: '/wholesale', label: 'Wholesale' },
  { href: '/finances', label: 'Finances' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/items', label: 'To tend to' },
  { href: '/phones', label: 'Phones' },
]

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

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0">
          <Wordmark />
        </Link>
        {/* Horizontal scroll rather than a hamburger — a tap target beats a
            menu you have to open first, and there are enough links now
            (nine, past the five this was written for) that it won't all fit
            on a phone regardless. min-w-0 is load-bearing: a flex child
            defaults to refusing to shrink below its content's width, so
            without it this pushed Sign out off the edge of the screen
            instead of actually scrolling — this is what was cut off. */}
        <nav className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-sunk hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        {person ? (
          <span className="shrink-0 text-sm text-muted" title="Signed in from your own link">
            {person.name}
          </span>
        ) : null}
        <form action={signOut}>
          <button className="shrink-0 text-sm text-faint hover:text-ink">Sign out</button>
        </form>
      </div>
    </header>
  )
}
