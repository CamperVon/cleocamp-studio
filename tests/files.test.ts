import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileProblem, MAX_FILE_BYTES, recordHref, sizeLabel } from '../lib/files'
import { toolResultContent } from '../lib/mouse/runner'
import { diagnosticValue } from '../lib/mouse/outcomes'

test('only PDFs and photos up to 4 MB, with a title, can be kept', () => {
  assert.equal(fileProblem({ mediaType: 'application/pdf', sizeBytes: 400_000, title: 'Calamo colour card' }), null)
  assert.match(fileProblem({ mediaType: 'application/pdf', sizeBytes: MAX_FILE_BYTES + 1 })!, /limit is 4 MB/)
  assert.match(fileProblem({ mediaType: 'application/zip', sizeBytes: 10 })!, /Only PDFs and photos/)
  assert.match(fileProblem({ mediaType: 'image/png', sizeBytes: 10, title: '  ' })!, /title/)
  assert.equal(sizeLabel(386_312), '377 KB')
  assert.equal(recordHref('component', 'c1'), '/components#rec-c1')
})

test('a kept file reaches Mouse as the document itself, and its bytes never reach the saved chat', () => {
  const result = { found: true, title: 'Calamo colour card', fileForModel: { mediaType: 'application/pdf', base64: 'JVBERi0x' } }
  const c = toolResultContent(result) as Array<{ type: string; text?: string }>
  assert.equal(c[0].type, 'document')
  assert.equal(c[1].type, 'text')
  assert.ok(!c[1].text!.includes('JVBERi0x'))
  assert.equal(typeof toolResultContent({ found: false }), 'string') // anything else stays JSON
  assert.ok(!JSON.stringify(diagnosticValue(result)).includes('JVBERi0x')) // what is stored with the chat turn
})
