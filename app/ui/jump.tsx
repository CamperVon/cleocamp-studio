'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Opening a page at one row: /vendors#rec-<id> unfolds the folds around that
 * vendor, scrolls to it and marks it for a moment. Rows say which record they
 * are with data-rec (an id would clash where a component is listed under
 * several products; the first is the one opened). Used by the search box
 * (app/ui/search.tsx), and by any link written the same way.
 */
export function jumpTo(hash: string, tries = 20) {
  const m = hash.match(/^#rec-(.+)$/)
  if (!m) return
  const id = decodeURIComponent(m[1])
  const el = document.querySelector<HTMLElement>(`[data-rec="${CSS.escape(id)}"]`) ?? document.getElementById(id)
  // The page may still be arriving: try again shortly, for about two seconds.
  if (!el) { if (tries > 0) setTimeout(() => jumpTo(hash, tries - 1), 100); return }
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true
  const own = el.querySelector(':scope > details')
  if (own instanceof HTMLDetailsElement) own.open = true
  // Cards and product sections that fold with a button keep their rows in the
  // page, hidden (data-fold-body): press the button just before each one.
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (a.hasAttribute('data-fold-body') && a.hidden) (a.previousElementSibling as HTMLElement | null)?.click()
  }
  // A row that opens itself on a tap (a component) is tapped open.
  if (el.getAttribute('aria-expanded') === 'false') el.click()
  // After the folds have opened.
  setTimeout(() => {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('rec-hit')
    setTimeout(() => el.classList.remove('rec-hit'), 2400)
  }, 60)
}

export function Jump() {
  const pathname = usePathname()
  useEffect(() => {
    jumpTo(window.location.hash)
    const on = () => jumpTo(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [pathname])
  return null
}
