import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textAttachmentsIn, textFromAttachments } from '../lib/inbound-body'

// The shape of Brandon's 22 Sept 10:54pm text as Resend delivered it: no body,
// the words in text_1.txt, a screenshot, and the carrier's SMIL layout file.
const mms = { type: 'email.received', data: { email_id: 'e1', attachments: [
  { id: 'a', filename: null, content_type: 'application/smil' },
  { id: 'b', filename: 'Screensho.png', content_type: 'image/png' },
  { id: 'c', filename: 'text_1.txt', content_type: 'text/plain' },
] } }

test('finds the text part of a carrier MMS, and only that', () => {
  assert.deepEqual(textAttachmentsIn(mms).map((a) => a.filename), ['text_1.txt'])
  assert.deepEqual(textAttachmentsIn({ data: {} }), [])
  assert.deepEqual(textAttachmentsIn(null), [])
})

test('does not call out when there is nothing to fetch', async () => {
  assert.equal(await textFromAttachments(undefined, mms), null)
  assert.equal(await textFromAttachments('e1', { data: { attachments: [] } }), null)
})
