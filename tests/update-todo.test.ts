import assert from 'node:assert/strict'
import test from 'node:test'
import { todoChanges } from '../lib/mouse/tools'

test('update_todo changes only what was passed', () => {
  assert.deepEqual(todoChanges({ id: 'x', urgent: true }), { urgent: true })
  assert.deepEqual(todoChanges({ id: 'x', urgent: false, detail: '' }), { urgent: false, detail: null })
  assert.deepEqual(todoChanges({ id: 'x', dueDate: '' }), { dueDate: null })
  assert.equal((todoChanges({ id: 'x', dueDate: '2026-10-09' }) as { dueDate: Date }).dueDate.toISOString(), '2026-10-09T19:00:00.000Z')
})

test('update_todo refuses a bad date and an empty change', () => {
  assert.ok('error' in todoChanges({ id: 'x', dueDate: 'Friday' }))
  assert.ok('error' in todoChanges({ id: 'x' }))
  assert.ok('error' in todoChanges({ id: 'x', title: '  ' }))
})
