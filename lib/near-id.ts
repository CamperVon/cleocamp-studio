/**
 * The one id a mistyped id was almost certainly meant to be, or null.
 *
 * 11 Nov 2026: Mouse updated the Cinergy pick-up todo as
 * "cmwcec0dr000707l08w63atuu" when its id is "cmwcec0dr000708l08w63atuu",
 * one character off, and did it twice. The refusal handed back the list of
 * open items, but a list of 30 random 25-character strings is exactly where
 * the copy went wrong in the first place, so the second try repeated it.
 *
 * Ids here are random cuids, so two real ones are never within a couple of
 * characters of each other: a near miss with exactly one candidate is a copy
 * slip, not doubt. Returns that candidate only when it is the single id within
 * `max` edits, or failing that the single id with the same first 17
 * characters; none or several, null. Pure.
 */
export function nearestId(given: string, ids: readonly string[], max = 2): string | null {
  const g = String(given ?? '').trim()
  if (g.length < 10) return null
  const hits = ids.filter((id) => id !== g && Math.abs(id.length - g.length) <= max && distance(g, id, max) <= max)
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) return null
  // 11 Nov 2026: "cmw9urp7o000k08l3ln5o0jx4" for "cmw9urp7o000k08l3dtixw1bj",
  // the time, counter and machine parts right and the random tail made up. A
  // cuid's first 17 characters already single out one item, so an id that
  // shares them with exactly one is that item.
  if (g.length < PREFIX) return null
  const same = ids.filter((id) => id !== g && id.slice(0, PREFIX) === g.slice(0, PREFIX))
  return same.length === 1 ? same[0] : null
}

const PREFIX = 17

/** Levenshtein distance, giving up (returning max + 1) once it exceeds max. */
function distance(a: string, b: string, max: number): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}
