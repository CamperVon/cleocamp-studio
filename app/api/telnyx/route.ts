import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { inboundFrom, telnyxSignatureValid } from '@/lib/telnyx'

/**
 * Telnyx posts here when our number receives a message (12 Oct 2026). For now
 * it only keeps the message: the first need is the one-time code Meta sends to
 * Mouse's new WhatsApp number. Nothing here runs Mouse or changes anything.
 *
 * Once TELNYX_PUBLIC_KEY is set, only requests Telnyx signed are kept. Until
 * then a message is kept and marked unsigned: storing text is harmless, and
 * the key is not needed to receive a verification code.
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
  await db.telnyxMessage.upsert({ where: { providerId: m.providerId }, create: { ...m, signed }, update: {} })
  return NextResponse.json({ ok: true, kept: true })
}
