/**
 * The Anthropic account Mouse runs on running out of credit (6 Oct 2026).
 * Every call fails at once with "Your credit balance is too low to access
 * the Anthropic API", and the chat said only "The model connection failed",
 * which reads as a glitch to retry rather than a bill to pay. Brandon:
 * "it should say when out of credit."
 */
export function isOutOfCredit(message: string | null | undefined): boolean {
  return /credit balance is too low|insufficient (?:credit|funds)|purchase credits/i.test(message ?? '')
}

/** What the person sees instead of a reply. Fixed text. */
export const OUT_OF_CREDIT_TEXT =
  'I can’t answer right now: the Anthropic account I run on is out of credit. Nothing was changed. ' +
  'Brandon can top it up at console.anthropic.com, under Plans & Billing (turning on auto-reload stops this happening again). ' +
  'Ask me again once it is topped up.'

/** The troubleshooting log's line for it, the same every time so repeats count up on one row. */
export const OUT_OF_CREDIT_LOG = 'Out of Anthropic API credit: every model call is refused until the account is topped up.'
