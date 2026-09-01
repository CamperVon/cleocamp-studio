/**
 * Calendar — subscribed, read-only.
 *
 * A published iCloud feed (and an imported Google calendar) is read-only by
 * definition. Studio Mouse can see what is on the calendar but cannot add to
 * it; writing needs Google OAuth against a calendar Cleo owns, which is on the
 * backlog alongside Drive write-back.
 */

export type FeedEvent = {
  uid: string
  title: string
  start: Date
  end: Date | null
  allDay: boolean
  location: string | null
  notes: string | null
}

/** Unfold RFC 5545 continuation lines, which are split at 75 octets. */
function unfold(ics: string) {
  return ics.replace(/\r?\n[ \t]/g, '')
}

function parseStamp(value: string, params: string): { date: Date; allDay: boolean } | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    // Date-only values are floating; anchor them to Pacific noon so a timezone
    // shift can never move them onto the wrong day.
    return { date: new Date(`${y}-${m}-${d}T12:00:00-07:00`), allDay: true }
  }
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value)
  if (!full) return null
  const [, y, m, d, hh, mm, ss, z] = full
  if (z === 'Z') return { date: new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`), allDay: false }
  // TZID values from this feed are America/Los_Angeles. Treating them as
  // Pacific is correct here and beats guessing UTC, which would shift by hours.
  const tz = /TZID=([^;:]+)/.exec(params)?.[1]
  const offset = !tz || tz.startsWith('America/Los_Angeles') ? '-07:00' : 'Z'
  return { date: new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}${offset}`), allDay: false }
}

export function parseIcs(raw: string): FeedEvent[] {
  const out: FeedEvent[] = []
  for (const chunk of unfold(raw).split('BEGIN:VEVENT').slice(1)) {
    const body = chunk.split('END:VEVENT')[0]
    const field = (name: string) => {
      const m = new RegExp(`^${name}([^:\\r\\n]*):(.*)$`, 'm').exec(body)
      return m ? { params: m[1], value: m[2].trim() } : null
    }
    const start = field('DTSTART')
    const summary = field('SUMMARY')
    const uid = field('UID')
    if (!start || !uid) continue
    const s = parseStamp(start.value, start.params)
    if (!s || Number.isNaN(s.date.getTime())) continue
    const end = field('DTEND')
    const e = end ? parseStamp(end.value, end.params) : null

    out.push({
      uid: uid.value,
      title: (summary?.value ?? 'Untitled').replace(/\\,/g, ',').replace(/\\n/g, ' ').trim(),
      start: s.date,
      end: e?.date ?? null,
      allDay: s.allDay,
      location: field('LOCATION')?.value.replace(/\\,/g, ',') ?? null,
      notes: field('DESCRIPTION')?.value.replace(/\\n/g, '\n').replace(/\\,/g, ',') ?? null,
    })
  }
  return out
}

export async function fetchFeed(url = process.env.CALENDAR_FEED_URL) {
  if (!url) throw new Error('CALENDAR_FEED_URL is not set')
  const https = url.replace(/^webcal:\/\//, 'https://')
  const res = await fetch(https, { cache: 'no-store' })
  if (!res.ok) throw new Error(`calendar feed ${res.status}`)
  return parseIcs(await res.text())
}
