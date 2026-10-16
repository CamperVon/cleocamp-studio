/**
 * Pattern labels (Prompt 4, Part 2, 16 Oct 2026). A style can have more than
 * one physical pattern: the Cleo Tee has TCO101-P1, for pre-washed fabric
 * (sampling with Pat), and TCO101-P2, for PFD (at Empire). A cut-and-sew
 * line on a purchase order says which one it is cut from.
 *
 * A pattern is a production detail. It lives on patterns and purchase-order
 * lines only: never a variant, a SKU, a colourway or anything sent to
 * Shopify. The code is the style number, -P, and a number that is never
 * reused, archived ones included.
 *
 * Pure: no imports from the database. The reads and writes are in
 * lib/po-patterns.ts.
 */

export const PATTERN_RE = /^[A-Z]{3}[157]\d{2}-P[1-9]\d*$/

export type PatternStatusName = 'ACTIVE' | 'RETIRING' | 'ARCHIVED'
export type PatternLite = { id: string; code: string; status: PatternStatusName; description?: string | null; fabric?: string | null }

/** The next code for a style: one past the highest it has ever had. */
export function nextPatternCode(styleNumber: string, existingCodes: string[]): string {
  const prefix = `${styleNumber}-P`
  const used = existingCodes.filter((c) => c.startsWith(prefix)).map((c) => Number(c.slice(prefix.length))).filter((n) => Number.isInteger(n))
  return `${prefix}${used.length ? Math.max(...used) + 1 : 1}`
}

/**
 * The patterns a line can default to: the active ones, or, when none is
 * active, the ones being retired (a style whose only pattern is on its way
 * out is still cut from it). Archived patterns never.
 */
export function patternChoices(patterns: PatternLite[]): PatternLite[] {
  const active = patterns.filter((p) => p.status === 'ACTIVE')
  return active.length ? active : patterns.filter((p) => p.status === 'RETIRING')
}

const describe = (p: PatternLite) => `${p.code}${p.fabric ? ` (${p.fabric} fabric)` : p.description ? ` (${p.description})` : ''}`

export type ResolvedPattern = { code: string | null; problem: string | null }

/**
 * Which pattern a line goes out with. A pattern picked on the line wins
 * (unless it has been archived). Otherwise, on a cut-and-sew order only: one
 * choice is the default, two or more is a problem the send must stop on, and
 * none means the style has no pattern on file, which is not a problem. Pure.
 */
export function resolvePattern(
  line: { pattern?: PatternLite | null },
  style: { number: string; patterns: PatternLite[] } | null,
  cutAndSew: boolean,
): ResolvedPattern {
  if (line.pattern) {
    if (line.pattern.status === 'ARCHIVED') {
      const others = style ? patternChoices(style.patterns) : []
      return { code: null, problem: `${line.pattern.code} is archived. Pick another${others.length ? `: ${others.map(describe).join(' or ')}` : ''}.` }
    }
    return { code: line.pattern.code, problem: null }
  }
  if (!cutAndSew || !style) return { code: null, problem: null }
  const choices = patternChoices(style.patterns)
  if (choices.length === 1) return { code: choices[0].code, problem: null }
  if (choices.length === 0) return { code: null, problem: null }
  return { code: null, problem: `${style.number} has ${choices.length} patterns in use, ${choices.map(describe).join(' and ')}: pick one for this line before it is sent.` }
}

/** "Pattern: TCO101-P2", in the document's own word for pattern. Pure. */
export const patternLine = (code: string, word: string) => `${word}: ${code}`
