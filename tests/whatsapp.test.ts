import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forWhatsApp, normalizePhone, teamMemberFor } from '../lib/whatsapp'
import { inboundFrom } from '../lib/telnyx'

// Mouse on WhatsApp (12 Oct 2026): Brandon, Cleo and Jane only.

test('a number on file matches however it was typed', () => {
  assert.equal(normalizePhone('(213) 619-0002'), '+12136190002')
  assert.equal(normalizePhone('+1 213 619 0002'), '+12136190002')
  assert.equal(normalizePhone('12136190002'), '+12136190002')
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123')
  assert.equal(normalizePhone(''), null)
  const team = [{ id: 'per_cleo', phone: '310-555-3898' }, { id: 'per_jane', phone: null }]
  assert.equal(teamMemberFor('+13105553898', team)?.id, 'per_cleo')
  assert.equal(teamMemberFor('+13105559999', team), null, 'a stranger is nobody')
  assert.equal(teamMemberFor('', team), null)
})

test('the reply reads right on WhatsApp and is cut at paragraph breaks', () => {
  assert.equal(forWhatsApp('**Done.** See [PO 2405](/po/2405).')[0], '*Done.* See [PO 2405] (https://admin.cleocamp.com/po/2405).')
  assert.equal(forWhatsApp('## Heading\nText')[0], 'Heading\nText')
  const long = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`
  const parts = forWhatsApp(long)
  assert.equal(parts.length, 2)
  assert.ok(parts.every((p) => p.length <= 3900))
  assert.equal(parts[1], 'b'.repeat(3000))
})

test('a WhatsApp webhook is read whether the number comes as an object or bare, media counted', () => {
  const m = inboundFrom({ data: { event_type: 'message.received', payload: { id: 'w1', type: 'WHATSAPP', from: '+13105553898', to: [{ phone_number: '+12136190002' }], text: 'how many white tees', media: [{ url: 'x' }] } } })
  assert.deepEqual(m, { providerId: 'w1', fromNumber: '+13105553898', toNumber: '+12136190002', text: 'how many white tees', channel: 'WHATSAPP', media: 1 })
})
