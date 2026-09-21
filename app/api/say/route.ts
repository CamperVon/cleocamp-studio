import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { chatTurn } from '@/lib/mouse/agent'
import { personFromSayToken, tokenFromRequest, threadForPerson, spokenLine } from '@/lib/say'

/**
 * Tell Mouse something, from anywhere, in one step.
 *
 * Brandon, 21 Sept 2026: "the more friction that exists, the less Mouse will
 * get updated." He is right, and it is the whole problem — the facts worth
 * having are the ones noticed away from a desk. A batch of cotton reaching a
 * factory is seen by someone holding a phone, in a car, with no inclination
 * to open an app and type.
 *
 * So this is one endpoint with no shape of its own: text in, one line back.
 * The Siri shortcut and the home-screen page are both thin clients onto it,
 * and anything later — a watch, a widget — is another. The same reasoning as
 * the note that says a purchase is one fact with three doors and they all
 * count the same. Deliberately NOT another mailbox: mail is untrusted and
 * becomes a proposal someone confirms (CLAUDE.md §4), which would move the
 * friction into a confirmation queue rather than remove it.
 *
 * WHAT MAKES THAT SAFE IS THE TOKEN. A person holding their own secret is a
 * known human, not an anonymous sender, so what they say is recorded rather
 * than proposed. That is the entire difference between this door and the
 * inbox, and it is why the token is the only thing standing in front of it.
 */

// A dictated sentence is short, but Mouse still has to think about it, look
// things up and write. Well under the 300 the chat route allows, because
// somebody is holding a phone waiting for the answer.
export const maxDuration = 120

const MAX_CHARS = 4000

export async function POST(req: NextRequest) {
  const person = await personFromSayToken(tokenFromRequest(req))
  if (!person) {
    // Say nothing about why. A wrong token and an unknown one look identical.
    return NextResponse.json({ error: 'not recognised' }, { status: 401 })
  }

  // Take the words out of whatever shape they arrive in.
  //
  // The page sends JSON. A Siri shortcut sends whichever body type the person
  // happened to tap in Shortcuts — JSON, Form, or a raw file — and there is no
  // reason for the wrong guess to be a silent failure they cannot diagnose on
  // a phone. All three are read here, and anything unrecognised is taken as
  // the sentence itself, which is the friendliest possible reading.
  const raw = await req.text()
  let text = raw
  if (raw.trimStart().startsWith('{')) {
    try {
      const body = JSON.parse(raw) as { text?: string; message?: string }
      text = body.text ?? body.message ?? ''
    } catch {
      /* Not JSON after all — treat the whole thing as what they said. */
    }
  } else if (/^[^=&\s]+=/.test(raw)) {
    // Form-encoded: text=the+cotton+arrived. Without this branch a Form body
    // is stored verbatim, "text=the+cotton+arrived" and all.
    const form = new URLSearchParams(raw)
    text = form.get('text') ?? form.get('message') ?? raw
  }
  text = text.trim().slice(0, MAX_CHARS)
  if (!text) {
    return NextResponse.json({ ok: false, spoken: 'I did not catch that.' }, { status: 400 })
  }

  const threadId = await threadForPerson(person)

  // Name the speaker in the turn itself. Mouse has no other way to know, and
  // "who told us" is half the value of an update — the author belongs with
  // the fact, not in a column nothing reads back.
  const instruction = `[${person.name}, dictated from their phone] ${text}`

  await db.chatMessage.create({ data: { threadId, role: 'USER', content: instruction } })

  const r = await chatTurn(threadId, instruction)

  await db.chatMessage.create({
    data: {
      threadId,
      role: 'ASSISTANT',
      content: r.text || '(no reply)',
      toolCallsJson: r.toolCalls.length ? (r.toolCalls as never) : undefined,
      model: r.model,
      agentUsageJson: r.usage as never,
    },
  })

  const spoken = spokenLine(r.text)

  // `format=text` returns the bare line, which is what a shortcut wants to
  // hand straight to "Speak Text" without parsing anything.
  if (req.nextUrl.searchParams.get('format') === 'text') {
    return new NextResponse(spoken, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  return NextResponse.json({
    ok: true,
    spoken,
    reply: r.text,
    // Whether anything was actually written, so the page can show it plainly
    // and a silent no-op cannot pass for a recorded update.
    recorded: r.writes.map((w) => w.summary),
    threadId,
  })
}
