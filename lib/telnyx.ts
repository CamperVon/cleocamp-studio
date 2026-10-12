import { createPublicKey, verify } from 'node:crypto'

/**
 * Telnyx, the team's phone provider, and Mouse's WhatsApp number (12 Oct
 * 2026). This file reads what Telnyx sends; nothing in it acts on a message.
 */

// The DER header that turns a raw 32-byte ed25519 key into one node can read.
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * Is this webhook really from Telnyx? Telnyx signs "timestamp|body" with its
 * ed25519 key; the public half is shown in its portal and set by hand as
 * TELNYX_PUBLIC_KEY (base64). A signature older than five minutes is refused,
 * so a captured request cannot be replayed later. Pure apart from the clock.
 */
export function telnyxSignatureValid(o: { body: string; signature: string | null; timestamp: string | null; publicKey: string; now?: number }): boolean {
  if (!o.signature || !o.timestamp) return false
  const ts = Number(o.timestamp)
  if (!Number.isFinite(ts) || Math.abs((o.now ?? Date.now()) / 1000 - ts) > 300) return false
  try {
    const raw = Buffer.from(o.publicKey, 'base64')
    if (raw.length !== 32) return false
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: 'der', type: 'spki' })
    return verify(null, Buffer.from(`${o.timestamp}|${o.body}`), key, Buffer.from(o.signature, 'base64'))
  } catch {
    return false
  }
}

export type InboundMessage = { providerId: string; fromNumber: string; toNumber: string | null; text: string; channel: string | null; media: number }

/** A Telnyx message.received webhook, read into what is kept; null for anything else. Pure. */
export function inboundFrom(body: unknown): InboundMessage | null {
  const d = (body as { data?: { event_type?: unknown; payload?: Record<string, unknown> } } | null)?.data
  if (!d || d.event_type !== 'message.received' || !d.payload) return null
  const p = d.payload
  const id = typeof p.id === 'string' ? p.id : null
  // SMS sends from/to as objects; accept a bare number too.
  const num = (x: unknown) => (typeof x === 'string' ? x : (x as { phone_number?: unknown } | undefined)?.phone_number)
  const from = num(p.from)
  if (!id || typeof from !== 'string') return null
  const to = num(Array.isArray(p.to) ? p.to[0] : p.to)
  return {
    providerId: id.slice(0, 100),
    fromNumber: from.slice(0, 40),
    toNumber: typeof to === 'string' ? to.slice(0, 40) : null,
    text: typeof p.text === 'string' ? p.text.slice(0, 4000) : '',
    channel: typeof p.type === 'string' ? p.type.slice(0, 20) : null,
    media: Array.isArray(p.media) ? p.media.length : 0,
  }
}
