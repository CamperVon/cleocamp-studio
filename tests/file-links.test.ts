import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkProblem } from '../lib/files'

// 16 Oct 2026: the style folders on Google Drive are kept in Files as links,
// attached to their products (Brandon: "just give us the links").

test('only whole https links are kept', () => {
  assert.equal(linkProblem('https://drive.google.com/drive/folders/1xTGAnS6gfwqk2pKA1iv3bvOz4cX9VHHS'), null)
  assert.match(linkProblem('drive.google.com/drive/folders/abc')!, /not a web address/)
  assert.match(linkProblem('http://example.com')!, /https/)
  assert.match(linkProblem('javascript:alert(1)')!, /https/)
  assert.match(linkProblem('file:///etc/passwd')!, /https/)
})
