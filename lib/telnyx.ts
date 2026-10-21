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
    text: textOf(p).slice(0, 4000),
    channel: typeof p.type === 'string' ? p.type.slice(0, 20) : null,
    media: Array.isArray(p.media) ? p.media.length : WA_MEDIA.has(waBody(p)?.type as string) ? 1 : 0,
  }
}

// WhatsApp puts the message in payload.body, shaped like Meta's own (body.type,
// then body.text.body, body.image.caption, ...); SMS puts it in payload.text.
// Until 21 Oct 2026 only payload.text was read, so every WhatsApp message
// arrived empty and was dropped without a reply.
const WA_MEDIA = new Set(['image', 'document', 'audio', 'video', 'sticker'])
type WaBody = { type?: unknown; [k: string]: unknown }
const waBody = (p: Record<string, unknown>): WaBody | null => (p.body && typeof p.body === 'object' ? (p.body as WaBody) : null)
const str = (x: unknown) => (typeof x === 'string' ? x : '')

function textOf(p: Record<string, unknown>): string {
  if (typeof p.text === 'string' && p.text.trim()) return p.text
  const b = waBody(p)
  if (!b) return typeof p.body === 'string' ? p.body : ''
  const at = (k: string) => (b[k] && typeof b[k] === 'object' ? (b[k] as Record<string, unknown>) : {})
  const type = str(b.type)
  if (type === 'text' || !type) return str(at('text').body)
  if (WA_MEDIA.has(type)) return str(at(type).caption)
  if (type === 'button') return str(at('button').text)
  if (type === 'interactive') {
    const i = at('interactive')
    const pick = (k: string) => (i[k] && typeof i[k] === 'object' ? str((i[k] as Record<string, unknown>).title) : '')
    return pick('button_reply') || pick('list_reply')
  }
  return ''
}
