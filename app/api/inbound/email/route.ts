import { NextResponse, type NextRequest } from 'next/server'
import { Webhook } from 'svix'
import { db } from '@/lib/db'

/**
 * Inbound email — anything CC'd or forwarded to Studio Mouse.
 *
 * SECURITY. This endpoint is public by necessity: Resend cannot hold a session
 * cookie. Two things guard it.
 *
 *  1. Every request must carry a valid Svix signature from Resend. Without
 *     this, anyone who found the URL could POST fabricated mail and feed the
 *     database whatever they liked.
 *  2. Nothing here is ever applied. Mail is stored and nothing more. Studio
 *     Mouse reads it later and raises *proposals* a human confirms, because
 *     anyone who can email the company must not be able to write to inventory.
 *     See CLAUDE.md §4.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  const body = await req.text()
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }

  try {
    new Webhook(secret).verify(body, headers)
  } catch {
    // Unsigned or tampered. Say nothing useful about why.
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // Parse the body ourselves rather than trusting verify() to hand back the
  // payload — it does not reliably, and taking its return value silently turned
  // every message into "unknown type" and dropped it with a 200.
  let event: any
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'unparseable body' }, { status: 400 })
  }

  if (event?.type !== 'email.received') {
    return NextResponse.json({ ok: true, ignored: event?.type ?? 'unknown' })
  }

  const d = event.data ?? {}
  const to: string = Array.isArray(d.to) ? d.to.join(', ') : String(d.to ?? '')

  // The MX record makes the whole subdomain a catch-all, so every address at
  // send.cleocamp.com reaches us — including whatever spam finds it later.
  // Only store mail addressed to a mailbox we actually use. Unknown addresses
  // get a 200 so Resend stops retrying, but nothing is written.
  // `??` only catches null/undefined — an env var set to an empty string would
  // leave the list empty and silently reject every message. Treat blank as unset.
  const configured = (process.env.INBOUND_ALLOWED_MAILBOXES ?? '').trim()
  const allowed = (configured || 'mouse,team,studio,wholesale,billing,support,po,orders')
    .split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)

  const mailboxes = to.toLowerCase().split(',')
    .map((a) => a.trim().replace(/^.*</, '').replace(/>.*$/, '').split('@')[0])
  if (!mailboxes.some((m) => allowed.includes(m))) {
    return NextResponse.json({ ok: true, ignored: 'address not in use' })
  }

  // The webhook carries metadata only — no body. Fetch the content so Studio
  // Mouse has something to read.
  let text: string | null = d.text ?? null
  let html: string | null = d.html ?? null
  if (!text && !html && d.email_id && process.env.RESEND_API_KEY) {
    try {
      const r = await fetch(`https://api.resend.com/emails/receiving/${d.email_id}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      })
      if (r.ok) {
        const full = (await r.json()) as { text?: string; html?: string }
        text = full.text ?? null
        html = full.html ?? null
      }
    } catch {
      // Metadata is still worth keeping; the body can be fetched again later.
    }
  }

  await db.inboundEmail.upsert({
    where: { messageId: d.message_id ?? d.email_id ?? crypto.randomUUID() },
    create: {
      messageId: d.message_id ?? d.email_id ?? null,
      fromAddress: String(d.from ?? 'unknown'),
      toAddress: to,
      subject: d.subject ?? null,
      text,
      html,
      raw: event,
      receivedAt: d.created_at ? new Date(d.created_at) : new Date(),
    },
    update: {},
  })

  return NextResponse.json({ ok: true })
}
