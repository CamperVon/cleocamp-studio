import type { ReactNode } from 'react'

export function Page({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {lede ? <p className="mt-1.5 text-sm text-muted sm:text-base">{lede}</p> : null}
      </div>
      <div className="flex flex-col gap-6 sm:gap-8">{children}</div>
    </main>
  )
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-faint sm:px-5">{children}</p>
}

/** Renders a value, or a clearly-marked gap. Unknown is never shown as zero. */
export function Value({ value, unit }: { value: unknown; unit?: string }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-faint italic">unknown</span>
  }
  return (
    <span className="tnum">
      {String(value)}
      {unit ? <span className="text-faint"> {unit}</span> : null}
    </span>
  )
}

export function Money({ cents }: { cents: number | null | undefined }) {
  if (cents === null || cents === undefined) return <Value value={null} />
  return <span className="tnum">${(cents / 100).toFixed(2)}</span>
}

const TONES = {
  neutral: 'bg-sunk text-muted',
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  urgent: 'bg-urgent-soft text-urgent',
} as const

export function Chip({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-faint">{label}</p>
      <p className="tnum mt-0.5 text-2xl font-semibold leading-none">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
    </div>
  )
}
