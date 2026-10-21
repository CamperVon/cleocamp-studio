import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { inboundFrom, telnyxSignatureValid } from '../lib/telnyx'

// Telnyx webhook (12 Oct 2026): first job, catch Meta's code for Mouse's WhatsApp number.

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
const now = 1_791_800_000_000
const ts = String(now / 1000)
const body = JSON.stringify({ data: { event_type: 'message.received', payload: { id: 'm1', from: { phone_number: '+15551234567' }, to: [{ phone_number: '+13235550100' }], text: 'Your WhatsApp code is 123-456', type: 'SMS' } } })
const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64')

test('only a fresh request Telnyx signed is accepted', () => {
  assert.equal(telnyxSignatureValid({ body, signature: sig, timestamp: ts, publicKey: pub, now }), true)
  assert.equal(telnyxSignatureValid({ body: body + ' ', signature: sig, timestamp: ts, publicKey: pub, now }), false, 'body changed')
  assert.equal(telnyxSignatureValid({ body, signature: sig, timestamp: ts, publicKey: pub, now: now + 10 * 60_000 }), false, 'replayed later')
  assert.equal(telnyxSignatureValid({ body, signature: null, timestamp: ts, publicKey: pub, now }), false)
  assert.equal(telnyxSignatureValid({ body, signature: sig, timestamp: ts, publicKey: 'not-a-key', now }), false)
})

test('a received message is read; other events are not', () => {
  assert.deepEqual(inboundFrom(JSON.parse(body)), { providerId: 'm1', fromNumber: '+15551234567', toNumber: '+13235550100', text: 'Your WhatsApp code is 123-456', channel: 'SMS', media: 0 })
  assert.equal(inboundFrom({ data: { event_type: 'message.finalized', payload: { id: 'x' } } }), null)
  assert.equal(inboundFrom({ nonsense: true }), null)
  assert.equal(inboundFrom(null), null)
})

test('a WhatsApp message is read from payload.body, where Telnyx puts it', () => {
  const wa = (b: unknown) => inboundFrom({ data: { event_type: 'message.received', payload: { id: 'w1', from: { phone_number: '+15551234567' }, to: '+12136190002', type: 'WHATSAPP', body: b } } })
  assert.deepEqual(wa({ type: 'text', text: { body: 'How many White tees are left?' } }), { providerId: 'w1', fromNumber: '+15551234567', toNumber: '+12136190002', text: 'How many White tees are left?', channel: 'WHATSAPP', media: 0 })
  assert.equal(wa({ text: { body: 'no type given' } })!.text, 'no type given')
  const photo = wa({ type: 'image', image: { id: 'i1', caption: 'the slip' } })!
  assert.equal(photo.text, 'the slip')
  assert.equal(photo.media, 1)
  assert.equal(wa({ type: 'button', button: { text: 'Yes' } })!.text, 'Yes')
  assert.equal(wa({ type: 'interactive', interactive: { button_reply: { title: 'Log it' } } })!.text, 'Log it')
  assert.equal(wa({ type: 'location', location: {} })!.text, '')
})
