import Link from 'next/link'
import { signOut } from '@/app/login/actions'
import { Wordmark } from './wordmark'

const LINKS = [
  { href: '/', label: 'Today' },
  { href: '/products', label: 'Products' },
  { href: '/components', label: 'Components' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/items', label: 'To tend to' },
]

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0">
          <Wordmark />
        </Link>
        {/* Horizontal scroll rather than a hamburger — five links fit, and a
            tap target beats a menu you have to open first. */}
        <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        <form action={signOut}>
          <button className="shrink-0 text-sm text-faint hover:text-ink">Sign out</button>
        </form>
      </div>
    </header>
  )
}
