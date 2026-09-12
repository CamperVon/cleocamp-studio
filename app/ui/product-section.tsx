'use client'
import { useState, type ReactNode } from 'react'
import { Chip } from './primitives'

/**
 * One product's parts list, collapsed until asked for.
 *
 * Brandon, 11 Sept: "Separate into sections per product. Make them drop down."
 * Every product appears, including ones with nothing recorded — "don't hide
 * products. we know we have to fill them." An empty section is a job to do, not
 * a product without parts, and hiding it would hide the job.
 */
export function ProductSection({
  name, count, children,
}: {
  name: string
  count: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-sunk sm:px-5"
      >
        <span className="inline-block w-3 text-faint">{open ? '▾' : '▸'}</span>
        <span className="font-medium">{name}</span>
        {count ? (
          <span className="text-xs text-faint">
            {count} component{count > 1 ? 's' : ''}
          </span>
        ) : (
          <Chip tone="warn">nothing recorded yet</Chip>
        )}
      </button>
      {open ? <div className="border-t border-line bg-sunk/40">{children}</div> : null}
    </div>
  )
}
