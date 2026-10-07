import assert from 'node:assert/strict'
import test from 'node:test'
import { APP, newsFor, sentenceHtml } from '../lib/mouse/daily-cheese'

test('a line with somewhere to open is a link to that row', () => {
  const html = sentenceHtml({ on: new Date(), tag: 'URGENT', sentence: 'Pull the skirt for Cleo & Jane.', href: `${APP}/items#rec-abc123` })
  assert.match(html, /^<a href="https:\/\/admin\.cleocamp\.com\/items#rec-abc123"/)
  assert.match(html, />Pull the skirt for Cleo &amp; Jane\.<\/a>$/)
  assert.equal(sentenceHtml({ on: new Date(), tag: 'TODAY', sentence: 'No link <here>.' }), 'No link &lt;here&gt;.')
})

test('the links note runs on 8 Oct 2026 only', () => {
  assert.match(newsFor('2026-10-08') ?? '', /every line below is now a link/)
  assert.equal(newsFor('2026-10-09'), null)
  assert.equal(newsFor('2026-10-07'), null)
})
