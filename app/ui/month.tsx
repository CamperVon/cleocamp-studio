/**
 * A month at a glance. Days carrying something are marked; today is ringed.
 *
 * Built from a Pacific "today" so the highlighted day is the one Cleo is
 * actually living in, not whatever UTC thinks.
 */
export function MonthGrid({
  marked,
  today,
}: {
  marked: Array<{ day: number; kind: 'event' | 'due' }>
  today: { year: number; month: number; day: number }
}) {
  const first = new Date(Date.UTC(today.year, today.month, 1))
  const daysInMonth = new Date(Date.UTC(today.year, today.month + 1, 0)).getUTCDate()
  const leading = first.getUTCDay()

  const byDay = new Map<number, 'event' | 'due'>()
  for (const m of marked) {
    // A deadline outranks a meeting when both land on the same square.
    if (m.kind === 'due' || !byDay.has(m.day)) byDay.set(m.day, m.kind)
  }

  const cells: Array<number | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const monthName = first.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })

  return (
    <div>
      <p className="mb-2 text-xs font-medium">{monthName}</p>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="pb-1 text-[10px] text-faint">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />
          const kind = byDay.get(d)
          const isToday = d === today.day
          return (
            <span key={i} className="flex flex-col items-center gap-0.5 py-0.5">
              <span
                className={
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs tnum ' +
                  (isToday ? 'bg-accent font-semibold text-white dark:text-[#0F1211]' : 'text-muted')
                }
              >
                {d}
              </span>
              <span
                className={
                  'h-1 w-1 rounded-full ' +
                  (kind === 'due' ? 'bg-warn' : kind === 'event' ? 'bg-accent' : 'bg-transparent')
                }
              />
            </span>
          )
        })}
      </div>
    </div>
  )
}
