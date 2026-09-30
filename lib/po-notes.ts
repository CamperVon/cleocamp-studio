/**
 * A purchase order's notes print on the copy the vendor receives (CLAUDE.md
 * §4). A tool description saying so was not enough: on 16 Sept 2026 a
 * repricing rationale reached Antonio's copy of PO 2360, and by 25 Sept PO
 * 2362 carried "Staples confirmed a partial delivery of 18 pieces arriving
 * 25 Sept, ahead of Cleo's 27 Sept sale" on Staples' own copy. That is a
 * record of what the vendor said to us, plus our own plans, written as if
 * it were a message to them. Brandon, 30 Sept 2026: "Just fix for the
 * future."
 *
 * So Mouse's PO tools check the words before saving them. Catching every
 * internal remark is not possible from text alone; these are the shapes
 * that have actually got through: the vendor talked about in the third
 * person, one of our own people named, and our own money or plans. A
 * refusal points to add_note on the purchase order, which nothing renders.
 */

const TEAM = /\b(brandon|jane)\b|\bcleo['’]s\b/i
const REPORTED = /\b(confirmed|confirms|said|says|told|agreed|quoted|claims?|claimed|disputed|promised|mentioned|replied|emailed|called)\b/i
const OURS = /\b(disputed|used to (?:cost|be)|was \$|saving|saved us|margin|markup|our (?:sale|pop-?up|launch|event|customers?|cost)|pop-?up|live sale|internal(?:ly)?|check (?:with|on) (?:our|this)|to confirm our end|tbc)\b/i

/** Why these notes cannot print on a vendor's copy, or null if they may. Pure. */
export function vendorNoteProblem(notes: string | null | undefined, vendorName?: string | null): string | null {
  const text = (notes ?? '').trim()
  if (!text) return null
  const why: string[] = []
  const team = text.match(TEAM)
  if (team) why.push(`it names one of our own people ("${team[0]}")`)
  if (vendorName) {
    // "Staples confirmed…": the vendor as the subject of a report is a note
    // ABOUT them. Matched on the first word of the name so "Staples LA USA"
    // still catches "Staples confirmed".
    const first = vendorName.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}]/gu, '')
    if (first && first.length > 2) {
      const m = text.match(new RegExp(`\\b${first}\\b[^.]{0,40}?${REPORTED.source}`, 'i'))
      if (m) why.push(`it reports what ${vendorName} said ("${m[0].trim()}"), which is our record, not a message to them`)
    }
  }
  const ours = text.match(OURS)
  if (ours) why.push(`it is about our own business ("${ours[0]}")`)
  if (!why.length) return null
  return (
    `Not saved: these notes print on the copy ${vendorName ?? 'the vendor'} receives, and ${why.join('; ')}. ` +
    'Only put there what we are saying TO the vendor (a rush request, a spec, a payment confirmation). ' +
    'Save the rest with add_note against the purchase order, which nothing prints.'
  )
}
