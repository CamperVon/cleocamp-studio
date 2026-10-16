/**
 * The first patterns (Prompt 4, Part 2, 16 Oct 2026), as a plan that
 * scripts/seed-patterns.ts applies. Pure, so the rules are tested without a
 * database.
 *
 * The Cleo Tee's two patterns are as Brandon gave them. Every other style
 * that has been made (a production run, or a purchase order with a maker)
 * gets one, P1, "current pattern". Who holds it is not on file, so it stays
 * unknown and one open question asks, naming the maker of the latest run as
 * the likely answer. Never a guess written as a fact.
 */

export const CLEO_TEE = 'TCO101'

export const CLEO_TEE_PATTERNS = [
  {
    code: 'TCO101-P1', fabric: 'pre-washed', heldBy: 'Pat', status: 'ACTIVE' as const,
    description: 'Pattern #1, for pre-washed fabric. Sampling with Pat; becomes the standard once we move off PFD (in the next few months).',
  },
  {
    code: 'TCO101-P2', fabric: 'PFD', heldBy: "Empire (Antonio's)", status: 'ACTIVE' as const,
    description: 'Pattern #2, for PFD fabric. Becomes RETIRING when we move off PFD.',
  },
]

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
    if (!s.makers.length) continue
    create.push({ styleId: s.id, code: `${s.number}-P1`, description: 'current pattern', fabric: null, heldBy: null, status: 'ACTIVE' })
    const last = [...s.makers].sort((a, b) => b.at.getTime() - a.at.getTime())[0]
    unknownHolder.push({ number: s.number, name: s.name, likely: last.vendor, ref: last.ref })
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
