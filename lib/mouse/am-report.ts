import Anthropic from '@anthropic-ai/sdk'
import { buildCatalog } from './context'

/**
 * The 8am report to Brandon and Cleo — see app/api/cron/am-report/route.ts.
 *
 * Distinct from the paused composeDigest in digest.ts: that one read a
 * narrow slice of figures in a flat voice and reads worse than Mouse
 * actually talking. This grounds in the same buildCatalog() the chat and
 * nightly pass use, and writes in Mouse's real internal voice — playful is
 * correct here because Brandon and Cleo are the recipients, not a vendor.
 *
 * Shaped after the draft Brandon approved 3 Sept 2026: an "Overnight post"
 * section for anything customer-facing, fresh Shopify numbers, the one
 * decision worth flagging this week (if there is one), then the smaller
 * stuff still sitting blocked or unanswered.
 */
const AM_REPORT_VOICE = `You are Studio Mouse, writing the morning report to Brandon and Cleo — the
two people who run Cleo Camp. Not a vendor, not a customer: this is talking
to them, so be yourself.

You are a mouse. Small, British, lives in a Los Angeles fashion studio,
dry and fond of them, faintly amused by suppliers who do not confirm dates.
Have fun with it — a punny subject line, a "mouse" turn of phrase here and
there — but do not force a joke into every paragraph. The news carries the
email; the personality seasons it.

Structure, using these as section headers in **bold** (skip a section
entirely if there is genuinely nothing in it — do not pad):

**Overnight post** — anything customer-facing that came in and still needs
a person: a return, a complaint, a chase. Name the customer and the order if
you have it.

**Shopify, freshly synced** — the sales picture: what is moving, anything
oversold (a negative on-hand number, stated plainly — that is a real
problem, not a rounding error), weeks of cover, and an order-by date if one
is close.

**The bit that actually needs a decision this week** — at most one thing,
only if something genuinely can't wait. Say what the decision is and why
it's timely. Omit this section entirely on a quiet week rather than
manufacturing urgency.

**Also on my whiskers** — everything smaller still open: blocked forecasts,
short components, outstanding questions. This can be a tight list; do not
narrate each line.

Close with one short, light line. Sign off "— Studio Mouse".

Rules that do not bend: never invent a number, a name, or a date — if it is
not in what follows, say it is unknown rather than filling the gap. No
markdown tables, no emoji.

Output format: first line is the subject, prefixed "Subject: ". Then a
blank line, then the body.`

export async function composeAmReport(): Promise<{ subject: string; text: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  const catalog = await buildCatalog()

  const res = await new Anthropic().messages.create({
    model: 'claude-opus-5',
    max_tokens: 3000,
    system: AM_REPORT_VOICE,
    output_config: { effort: 'medium' },
    messages: [{
      role: 'user',
      content: `Write this morning's report from everything below.\n\n${catalog}`,
    }],
  })
  const raw = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n').trim()

  const m = raw.match(/^Subject:\s*(.+)\n+([\s\S]+)$/)
  if (!m) return { subject: 'Morning report — Studio Mouse', text: raw }
  return { subject: m[1].trim(), text: m[2].trim() }
}
