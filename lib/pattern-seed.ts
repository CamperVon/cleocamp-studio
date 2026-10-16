/**
 * The first patterns (Prompt 4, Part 2, 16 Oct 2026), as a plan that
 * scripts/seed-patterns.ts applies. Pure, so the rules are tested without a
 * database.
 *
 * The Cleo Tee's two patterns are as Brandon gave them. Every other style
 * that has been made (a production run, or a purchase order with a maker)
 * gets one, P1, "current pattern". Who holds each is as Brandon confirmed
 * on 16 Oct 2026 (HOLDERS); a style missing from that list stays unknown and
 * one open question asks, naming the maker of the latest run as the likely
 * answer. Never a guess written as a fact.
 */

export const CLEO_TEE = 'TCO101'

export const CLEO_TEE_PATTERNS = [
  {
    code: 'TCO101-P1', fabric: 'pre-washed', heldBy: 'Pat', status: 'ACTIVE' as const,
    description: 'Pattern #1, for pre-washed fabric. Sampling with Pat; becomes the standard once we move off PFD (in the next few months).',
  },
  {
    code: 'TCO101-P2', fabric: 'PFD', heldBy: "Empire (Antonio's), Staples", status: 'ACTIVE' as const,
    description: 'Pattern #2, for PFD fabric. Becomes RETIRING when we move off PFD.',
  },
]

/**
 * Who holds each pattern, as Brandon confirmed on 16 Oct 2026 ("those 10
 * patterns are mostly right", adding that Staples also has the Long Sleeve
 * Cleo Tee's pattern #1, the Cleo Tee's #2 and the Cosmo's #1, and Empire
 * the Cleo Tee's #2 and the Cosmo's #1). A pattern can be held in two places.
 */
export const HOLDERS: Readonly<Record<string, string>> = {
  'ABB101-P1': 'Cinturificiog',
  'BFS101-P1': 'Staples',
  'DST101-P1': 'Novelty Fashion',
  'DYO101-P1': 'Fashion Garcia',
  'HBN101-P1': 'Lorena and Santos',
  'HCB101-P1': 'Lorena and Santos',
  'HCD101-P1': 'Lorena and Santos',
  'ICU101-P1': 'Staples',
  'SFR101-P1': 'Knit Collab',
  'TCC101-P1': "Empire (Antonio's), Staples",
  'TCL101-P1': 'Staples',
}

/** Styles with a pattern though nothing has been made yet: Brandon named them. */
export const PATTERN_WITHOUT_RUN = ['TCL101']

export type SeedStyle = { id: string; number: string; name: string; patternCount: number; makers: Array<{ vendor: string; at: Date; ref: string }> }
export type SeedPattern = { styleId: string; code: string; description: string; fabric: string | null; heldBy: string | null; status: 'ACTIVE' }

export function planPatternSeed(styles: SeedStyle[]) {
  const create: SeedPattern[] = []
  const unknownHolder: Array<{ number: string; name: string; likely: string | null; ref: string | null }> = []
  const skipped: string[] = []
  const problems: string[] = []
  if (!styles.some((s) => s.number === CLEO_TEE)) problems.push(`No style ${CLEO_TEE}: run the re-key (scripts/rekey-styles.ts --apply) first.`)
  for (const s of [...styles].sort((a, b) => a.number.localeCompare(b.number))) {
    if (s.patternCount) { skipped.push(`${s.number} already has ${s.patternCount} pattern(s)`); continue }
    if (s.number === CLEO_TEE) {
      for (const p of CLEO_TEE_PATTERNS) create.push({ styleId: s.id, code: p.code, description: p.description, fabric: p.fabric, heldBy: p.heldBy, status: p.status })
      continue
    }
    if (!s.makers.length && !PATTERN_WITHOUT_RUN.includes(s.number)) continue
    const code = `${s.number}-P1`
    create.push({ styleId: s.id, code, description: 'current pattern', fabric: null, heldBy: HOLDERS[code] ?? null, status: 'ACTIVE' })
    if (HOLDERS[code]) continue
    const last = [...s.makers].sort((a, b) => b.at.getTime() - a.at.getTime())[0]
    unknownHolder.push({ number: s.number, name: s.name, likely: last?.vendor ?? null, ref: last?.ref ?? null })
  }
  return { create, unknownHolder, skipped, problems }
}

/** The open question for the holders nobody has recorded. */
export function holderQuestion(unknown: ReturnType<typeof planPatternSeed>['unknownHolder']) {
  return {
    title: `Who holds the patterns for ${unknown.length} styles?`,
    detail:
      'For Brandon and Cleo (pattern labels, 16 Oct 2026). Each style that has been made now has one pattern, P1, ' +
      '"current pattern", with nobody recorded as holding it. The likely holder is whoever made the latest run; ' +
      'say which are right and which are not, and Mouse will record them:\n' +
      unknown.map((u) => `- ${u.number}-P1 (${u.name}): probably ${u.likely ?? 'unknown'}${u.ref ? `, ${u.ref}` : ''}`).join('\n'),
  }
}
