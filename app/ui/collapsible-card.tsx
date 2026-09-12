'use client'
import { useState, type ReactNode } from 'react'

/**
 * A Card that folds away.
 *
 * Brandon, 12 Sept: "At vendor should be a drop down" — that section alone is
 * 24 rows, and four full tables stacked under the per-product view made the
 * page a long scroll again, which was the thing he asked to fix in the first
 * place.
 *
 * Same markup as Card in primitives.tsx, deliberately — this is that component
 * with a toggle, not a second look. It lives in its own file because
 * primitives.tsx is a server module; a 'use client' directive there would drag
 * every page that imports Page, Chip or Money into the client bundle.
 */
export function CollapsibleCard({
  title, defaultOpen = false, children,
}: {
  title: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-sunk sm:px-5 ${
          open ? 'border-b border-line' : ''
        }`}
      >
        <span className="inline-block w-3 shrink-0 text-faint">{open ? '▾' : '▸'}</span>
        <h2 className="flex items-center gap-2 text-sm font-semibold">{title}</h2>
      </button>
      {open ? children : null}
    </section>
  )
}
