/**
 * A line added to a stylist's or a store's own notes, dated in Los Angeles,
 * under whatever is already there. Brandon, 5 Oct 2026, asking for a box on
 * Stylists and Wholesale "so that we can give thoughts, notes": Mouse's tools
 * only REPLACED those notes, and Mouse is never shown what they already say,
 * so a new thought would have wiped the old ones. Adding is done here, in
 * code, from the stored text, so nothing already written can be lost. Pure.
 */
export function appendNote(existing: string | null | undefined, text: string, now = new Date()): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const line = `${day}: ${text.trim()}`
  const before = (existing ?? '').trim()
  return before ? `${before}\n${line}` : line
}
