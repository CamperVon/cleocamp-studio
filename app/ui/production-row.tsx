import Link from 'next/link'
import { Mouse } from './mouse'
import type { ProductState, Strand } from '@/lib/production-view'

const LABEL: Record<Strand['kind'], string> = {
  order: 'Order',
  run: 'Making',
  date: 'Date',
  waiting: 'Waiting',
}

/**
 * One product, collapsed to a line.
 *
 * The first cut printed every purchase-order line inside the row, so PO 2360's
 * eighteen sizes became a paragraph of red text taller than the phone, and
 * every strand was red because every strand was a link. A status row has to be
 * readable at a glance or nobody opens the second one: one line each, the
 * colour saved for the thing that is actually wrong, and the detail a tap away
 * on the order itself.
 */
export function ProductionRow({ p }: { p: ProductState }) {
  return (
    <li>
      <details className="group">
        <summary
          className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-sunk sm:px-5
                     [&::-webkit-details-marker]:hidden"
        >
          {/* Our own chevron: the native marker is a flex item and pushes the
              content around, and this needs to read as tappable on a phone. */}
          <span
            aria-hidden
            className="shrink-0 text-faint transition-transform group-open:rotate-90"
          >
            ›
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {p.flag ? <Mouse size={17} className="shrink-0 text-urgent" /> : null}
              {/* The rewrite that made these rows readable dropped red from the
                  name itself along the way — only the mouse icon stayed red,
                  so a flagged product read as normal text with a small red
                  mark next to it rather than as a red line. */}
              <span className={`truncate text-sm font-medium ${p.flag ? 'text-urgent' : ''}`}>{p.name}</span>
            </span>
            {/* Red follows the whole row, not just the name and icon — a red
                product whose summary line stayed grey read as half a warning. */}
            <span className={`mt-0.5 block truncate text-xs ${p.flag ? 'text-urgent' : 'text-muted'}`}>
              {p.headline}
            </span>
          </span>

          <span className="shrink-0 text-right text-xs text-muted">
            {p.onHand === null ? (
              <span className="italic text-faint">no count</span>
            ) : (
              <>
                <span className="tnum">{p.onHand}</span>
                <span className="text-faint"> on hand</span>
              </>
            )}
          </span>
        </summary>

        <ul className="border-t border-line bg-sunk/40 py-1">
          {p.strands.map((s, i) => (
            <li
              key={i}
              className="flex gap-2 px-4 py-1.5 text-xs leading-relaxed sm:gap-3 sm:px-5 sm:pl-11"
            >
              <span
                className={`w-14 shrink-0 ${s.flag ? 'font-medium text-urgent' : 'text-faint'}`}
              >
                {LABEL[s.kind]}
              </span>
              {s.href ? (
                <Link href={s.href} className={`min-w-0 hover:underline ${s.flag ? 'text-urgent' : 'text-muted'}`}>
                  {s.text}
                </Link>
              ) : (
                <span className={`min-w-0 ${s.flag ? 'text-urgent' : 'text-muted'}`}>{s.text}</span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}
