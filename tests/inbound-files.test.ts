import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readableAttachmentsIn } from '../lib/inbound-body'

test('only PDFs and photos on an email are picked up to read', () => {
  const raw = { data: { attachments: [
    { filename: 'invoice.pdf', content_type: 'application/pdf' },
    { filename: 'receipt.jpg', content_type: 'image/jpeg' },
    { filename: 'text_1.txt', content_type: 'text/plain' },
    { filename: 'smil.smil', content_type: 'application/smil' },
    { filename: 'sheet.xlsx', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ] } }
  assert.deepEqual(readableAttachmentsIn(raw).map((a) => a.filename), ['invoice.pdf', 'receipt.jpg'])
  assert.deepEqual(readableAttachmentsIn(null), [])
})
