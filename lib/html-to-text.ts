/**
 * A readable plain-text approximation of an HTML email body.
 *
 * Brandon, 11 Sept 2026: "I'm still getting the forwards. Clogging up
 * email." The real problem: every forward of a message with no plain-text
 * part read "(no plain-text body — open it in the app)" — a Gmail reply
 * commonly has only an HTML part, and the forward body only ever looked at
 * `email.text`. Nicki's actual reply carrying Antonio's real pricing
 * ($9.50/pc, $8.50/pc over 1000 units, no deposit, a 2-3 week timeline) went
 * out as an empty-looking notification twice today — the exact "success
 * that does nothing" shape CLAUDE.md §6 warns about, just in a forward
 * instead of a write.
 *
 * Dependency-free on purpose — this is a stripped-down reader, not a
 * renderer, for a low-volume internal tool. It does not attempt to
 * distinguish new content from quoted history; Gmail nests the whole thread
 * in <blockquote> tags with no reliable text-only signal for "this part is
 * new", so the safer move is to keep it all and cap the total length rather
 * than guess at where to cut.
 */
export function htmlToText(html: string, maxChars = 4000): string {
  let s = html
    // Whole-tag removal — content and all — for anything never meant to be read.
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Block-level structure becomes line breaks before the tags disappear.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|blockquote)>/gi, '\n')
    .replace(/<(div|p|li|tr|blockquote)[^>]*>/gi, '')
    // Everything else is markup, not content.
    .replace(/<[^>]+>/g, '')

  // Named and numeric entities. Not exhaustive — the common ones a real
  // mail client actually emits.
  const named: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
    mdash: '—', ndash: '–', hellip: '…',
  }
  s = s.replace(/&(#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (_m, _g, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    return named[name?.toLowerCase()] ?? _m
  })

  // Collapse the whitespace HTML formatting leaves behind — trailing spaces
  // per line, and more than two blank lines in a row.
  s = s
    .split('\n').map((l) => l.replace(/[ \t ]+$/, '').replace(/^[ \t ]+/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (s.length > maxChars) {
    s = s.slice(0, maxChars).trimEnd() + '\n\n[…truncated — open in the app for the rest of this thread]'
  }
  return s
}
