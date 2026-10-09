import assert from 'node:assert/strict'
import test from 'node:test'
import { APP, newLines, sentenceHtml } from '../lib/mouse/daily-cheese'

test('a line with somewhere to open is a link to that row', () => {
  const html = sentenceHtml({ on: new Date(), tag: 'URGENT', sentence: 'Pull the skirt for Cleo & Jane.', href: `${APP}/items#rec-abc123` })
  assert.match(html, /^<a href="https:\/\/admin\.cleocamp\.com\/items#rec-abc123"/)
  assert.match(html, />Pull the skirt for Cleo &amp; Jane\.<\/a>$/)
  assert.equal(sentenceHtml({ on: new Date(), tag: 'TODAY', sentence: 'No link <here>.' }), 'No link &lt;here&gt;.')
})

test('each app update is announced once: on the first edition that has not carried it', async () => {
  const { WHATS_NEW, unannounced } = await import('../lib/whats-new')
  const updates = [{ on: '2026-10-08', text: 'Links.' }, { on: '2026-10-09', text: 'Stylist inventory.', path: '/stylists' }]
  assert.deepEqual(unannounced(updates, []).map((u) => u.text), ['Links.', 'Stylist inventory.'])
  assert.deepEqual(unannounced(updates, ['The Daily Cheese\n\nNew:\n- Links.\n']).map((u) => u.text), ['Stylist inventory.'])
  assert.deepEqual(unannounced(updates, ['- Links.', '- Stylist inventory.']), [])
  // Reviewed for days before going live is fine: nothing here is keyed to a date.
  for (const u of WHATS_NEW) assert.ok(u.text.trim() && !/\n/.test(u.text), 'one plain sentence or two, no line breaks')
})

test('the New block: app updates first, with their page, then what came in from Shopify', () => {
  assert.deepEqual(newLines([{ text: 'Stylist inventory.', path: '/stylists' }, { text: 'Links.' }], ['Boy Belt - Black is new in the app.']), [
    { text: 'Stylist inventory.', href: `${APP}/stylists` },
    { text: 'Links.' },
    { text: 'From Shopify: Boy Belt - Black is new in the app.', href: `${APP}/products` },
  ])
})
