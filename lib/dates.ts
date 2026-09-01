/**
 * All date boundaries are America/Los_Angeles.
 *
 * The naive trick — `new Date(new Date().toLocaleString('en-US', {timeZone}))` —
 * formats in LA then reparses in the *server's* zone, so on a UTC server it
 * lands on the wrong day and yesterday's events keep showing. Read the LA
 * calendar date explicitly instead.
 *
 * Date-only columns are stored at UTC midnight, so these return UTC midnight of
 * the LA day and compare correctly.
 */
export function laMidnight(daysAgo = 0): Date {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value)
  const d = new Date(Date.UTC(get('year'), get('month') - 1, get('day')))
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d
}

export const laDay = (d: Date) =>
  d.toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  })
