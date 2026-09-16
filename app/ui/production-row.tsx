import Link from 'next/link'
import { Mouse } from './mouse'
import type { ProductState } from '@/lib/production-view'

const KIND_LABEL: Record<string, string> = {
  order: 'order',
  run: 'at the maker',
  date: 'date',
  waiting: 'waiting on',
}

/**
 * One product, and everything happening to it.
 *
 * Collapsed it is a name, a one-line state and — when something is late or an
 * order has not gone out — a red mouse. Open it is the evidence: every order,
 * date and open question behind that line, each carrying its own date so the
 * reader can see how old the claim is rather than taking it on trust.
 */
export function ProductionRow({ p }: { p: ProductState }) {
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer items-start justify-between gap-3 px-4 py-3 hover:bg-sunk sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              {p.flag ? (
                <Mouse size={20} className="shrink-0 text-urgent" aria-label="needs attention" />
              ) : null}
              <span className={p.flag ? 'text-urgent' : ''}>{p.name}</span>
            </p>
            <p className="mt-0.5 text-xs leading-snug text-muted">{p.headline}</p>
          </div>
          <p className="shrink-0 text-right text-xs text-muted">
            {p.onHand === null ? (
              <span className="italic text-faint">count unknown</span>
            ) : (
              <>
                <span className="tnum">{p.onHand}</span> on hand
              </>
            )}
          </p>
        </summary>

        <ul className="flex flex-col gap-2 border-t border-line bg-sunk/40 px-4 py-3 sm:px-5">
          {p.strands.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-xs leading-relaxed">
              <span
                className={`mt-0.5 w-[5.5rem] shrink-0 uppercase tracking-wide ${
                  s.flag ? 'text-urgent' : 'text-faint'
                }`}
              >
                {KIND_LABEL[s.kind]}
              </span>
              <span className={`min-w-0 ${s.flag ? 'text-urgent' : 'text-muted'}`}>
                {s.href ? (
                  <Link href={s.href} className="underline decoration-line underline-offset-2 hover:decoration-current">
                    {s.text}
                  </Link>
                ) : (
                  s.text
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}
