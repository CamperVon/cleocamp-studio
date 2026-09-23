'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { signOut } from '@/app/login/actions'
import { Wordmark } from './wordmark'
import { Mouse } from './mouse'

/**
 * Two navs, one list.
 *
 * On a phone this used to be ten links in a strip that scrolled sideways with
 * nothing to say it scrolled, sharing the width with the full wordmark — so
 * what showed was "Home  Produc" and then Sign out. Brandon, 23 Sept 2026:
 * "the buttons at the top are kind of a pain, especially on mobile."
 *
 * So a phone gets a bottom tab bar: the four pages used every day, always
 * visible and under the thumb, and More for the rest. The earlier comment
 * here argued against a hamburger because "a tap target beats a menu you
 * have to open first" — still true, which is why the daily four are tabs and
 * only the occasional pages sit behind More.
 *
 * Desktop got the same split once it showed the same fault a size up: all
 * ten in one row cut off at "Fi" on a laptop-width screen.
 *
 * Sign out lives in More now on a phone. In the top corner it was the easiest thing on
 * the screen to hit by accident, and for anyone signed in from a personal
 * link an accidental tap is a dead end: the password screen, and no password.
 */

type Item = { href: string; label: string; short?: string; icon?: ReactNode }

const DAILY: Item[] = [
  { href: '/', label: 'Home', icon: <IconHome /> },
  { href: '/products', label: 'Products', icon: <IconTag /> },
  { href: '/purchase-orders', label: 'Purchase orders', short: 'POs', icon: <IconDoc /> },
  { href: '/items', label: 'To tend to', icon: <IconCheck /> },
]

const OCCASIONAL: Item[] = [
  { href: '/support', label: 'Support' },
  { href: '/components', label: 'Components' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/wholesale', label: 'Wholesale' },
  { href: '/finances', label: 'Finances' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/phones', label: 'Phones' },
]

/** A section counts as "here" for itself and anything under it — /po/2378 is Purchase orders. */
function isHere(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  if (href === '/purchase-orders' && pathname.startsWith('/po/')) return true
  return pathname === href || pathname.startsWith(href + '/')
}

export function NavBar({ personName }: { personName: string | null }) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const [deskMore, setDeskMore] = useState(false)

  // Escape closes the sheet; so does tapping outside it or any link in it.
  useEffect(() => {
    if (!moreOpen && !deskMore) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMoreOpen(false)
      setDeskMore(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen, deskMore])

  const inMore = OCCASIONAL.some((i) => isHere(pathname, i.href))

  return (
    <>
      <header className="z-20 shrink-0 border-b border-line bg-bg/85 backdrop-blur md:sticky md:top-0">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
          {/* Phone: just the mouse. The full wordmark took half the bar. */}
          <Link href="/" className="shrink-0 md:hidden" aria-label="Studio Mouse — home">
            <Mouse size={34} className="text-accent" />
          </Link>
          <Link href="/" className="hidden shrink-0 md:block">
            <Wordmark />
          </Link>

          {/* Desktop: the same split as the phone — the daily four in the row,
              the rest under More. All ten in one row ran out of room on a
              laptop-width screen and cut off at "Fi", the same problem the
              phone had, one size up. */}
          <nav className="hidden items-center gap-1 md:flex">
            {DAILY.map((l) => {
              const here = isHere(pathname, l.href)
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={here ? 'page' : undefined}
                  className={
                    'shrink-0 rounded-md px-2.5 py-1.5 text-sm ' +
                    (here ? 'text-ink underline decoration-accent decoration-2 underline-offset-[6px]' : 'text-muted hover:bg-sunk hover:text-ink')
                  }
                >
                  {l.label}
                </Link>
              )
            })}
            <div className="relative">
              <button
                type="button"
                onClick={() => setDeskMore((o) => !o)}
                aria-expanded={deskMore}
                className={
                  'shrink-0 rounded-md px-2.5 py-1.5 text-sm ' +
                  (inMore ? 'text-ink underline decoration-accent decoration-2 underline-offset-[6px]' : 'text-muted hover:bg-sunk hover:text-ink')
                }
              >
                More <span aria-hidden className="text-faint">&#9662;</span>
              </button>
              {deskMore ? (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setDeskMore(false)} />
                  <ul className="absolute left-0 top-full z-40 mt-1.5 w-52 divide-y divide-line border border-line bg-surface py-0.5 shadow-sm">
                    {OCCASIONAL.map((l) => {
                      const here = isHere(pathname, l.href)
                      return (
                        <li key={l.href}>
                          <Link
                            href={l.href}
                            aria-current={here ? 'page' : undefined}
                            onClick={() => setDeskMore(false)}
                            className={`block px-4 py-2 text-sm hover:bg-sunk ${here ? 'text-accent' : 'text-ink'}`}
                          >
                            {l.label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : null}
            </div>
          </nav>

          <span className="flex-1" />
          {personName ? (
            <span className="shrink-0 text-sm text-muted" title="Signed in from your own link">
              {personName}
            </span>
          ) : null}
          <form action={signOut} className="hidden md:block">
            <button className="shrink-0 text-sm text-faint hover:text-ink">Sign out</button>
          </form>
        </div>
      </header>

      {/* ── Phone: tab bar ─────────────────────────────────────── */}
      <nav
        // Pale pink, the quote card's colour, so the page has pink at both
        // ends without shouting. Brandon picked this over a solid pink bar
        // and a white one with pink icons, 23 Sept 2026.
        className="relative z-30 order-last shrink-0 border-t border-accent/20 bg-accent-soft md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Main"
      >
        <div className="mx-auto flex max-w-md">
          {DAILY.map((l) => {
            const here = isHere(pathname, l.href) && !moreOpen
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={here ? 'page' : undefined}
                onClick={() => setMoreOpen(false)}
                className={`flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] ${here ? 'font-semibold text-accent' : 'text-ink/65'}`}
              >
                {l.icon}
                {l.short ?? l.label}
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            className={`flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] ${moreOpen || inMore ? 'font-semibold text-accent' : 'text-ink/65'}`}
          >
            <IconMore />
            More
          </button>
        </div>
      </nav>

      {/* ── Phone: the More sheet ──────────────────────────────── */}
      {moreOpen ? (
        <div className="fixed inset-0 z-20 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-ink/20" />
          <div
            className="absolute inset-x-0 bottom-0 border-t border-line bg-surface pb-[calc(4.25rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <ul className="divide-y divide-line">
              {OCCASIONAL.map((l) => {
                const here = isHere(pathname, l.href)
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={here ? 'page' : undefined}
                      onClick={() => setMoreOpen(false)}
                      className={`block px-5 py-3.5 text-base ${here ? 'text-accent' : 'text-ink'}`}
                    >
                      {l.label}
                    </Link>
                  </li>
                )
              })}
              <li>
                <form action={signOut}>
                  <button className="block w-full px-5 py-3.5 text-left text-base text-faint">Sign out</button>
                </form>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </>
  )
}

// Line icons, drawn to sit with the mouse: one stroke weight, round ends, no fill.
const ic = {
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
}
function IconHome() {
  return <svg {...ic}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" /></svg>
}
function IconTag() {
  return <svg {...ic}><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0z" /><circle cx="8" cy="8" r="1.4" /></svg>
}
function IconDoc() {
  return <svg {...ic}><path d="M6 3.5h8.5L19 8v12a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20z" /><path d="M14.5 3.5V8H19M9 12.5h6M9 16h6" /></svg>
}
function IconCheck() {
  return <svg {...ic}><path d="m4.5 7 1.8 1.8L9.5 5.5M4.5 13.5l1.8 1.8 3.2-3.3M12.5 7.5h7M12.5 14h7M5 19.5h14.5" /></svg>
}
function IconMore() {
  return <svg {...ic}><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></svg>
}
