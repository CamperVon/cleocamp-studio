import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendNote } from '../lib/append-note'

test('a thought is added under the notes already there, dated in Los Angeles, never replacing them', () => {
  const at = new Date('2026-10-06T05:30:00Z') // still 5 Oct in LA
  assert.equal(appendNote('Pays on delivery.', '  Wants the Fall sheet in November. ', at), 'Pays on delivery.\n2026-10-05: Wants the Fall sheet in November.')
  assert.equal(appendNote(null, 'Returns pieces early.', at), '2026-10-05: Returns pieces early.')
  assert.equal(appendNote('  ', 'x', at), '2026-10-05: x')
})
