import { after, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { inboundFrom, telnyxSignatureValid } from '@/lib/telnyx'

// Mouse's answer to a WhatsApp message runs after Telnyx is told "received".
export const maxDuration = 300

/**
 * Telnyx posts here when our number receives a message (12 Oct 2026). Every
 * message is kept. A WhatsApp message is answered by Mouse only when Telnyx
 * signed it (TELNYX_PUBLIC_KEY) and it comes from Brandon, Cleo or Jane's
 * number on file (lib/whatsapp.ts). Until the key is set, messages are kept,
 * marked unsigned, and nothing acts on them.
 */
export async function POST(req: Request) {
  const raw = await req.text()
  if (raw.length > 100_000) return NextResponse.json({ error: 'too large' }, { status: 413 })
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim()
  const signed = publicKey
    ? telnyxSignatureValid({ body: raw, signature: req.headers.get('telnyx-signature-ed25519'), timestamp: req.headers.get('telnyx-timestamp'), publicKey })
    : false
  if (publicKey && !signed) return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'not json' }, { status: 400 }) }
  const m = inboundFrom(body)
  // Delivery receipts and other events are acknowledged and dropped.
  if (!m) return NextResponse.json({ ok: true, kept: false })
  const { media, ...row } = m
  // Telnyx retries a webhook it thinks failed: a message is answered once.
  const fresh = await db.telnyxMessage.create({ data: { ...row, signed } }).then(() => true, () => false)
  if (fresh && signed && /whatsapp/i.test(m.channel ?? '')) {
    after(async () => {
      const { answerWhatsApp } = await import('@/lib/whatsapp')
      await answerWhatsApp({ fromNumber: m.fromNumber, text: m.text, media }).catch((e) => console.error('[whatsapp]', e))
    })
  }
  return NextResponse.json({ ok: true, kept: fresh })
}
