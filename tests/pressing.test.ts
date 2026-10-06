import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPressing, pressingFirst } from '../lib/pressing'

const tomorrow = new Date('2026-10-07T00:00:00Z')
const d = (s: string) => new Date(`${s}T00:00:00Z`)

test('urgent, due today, overdue or inside the reminder window is pressing', () => {
  assert.equal(isPressing({ urgent: true, dueDate: null }, tomorrow), true)
  assert.equal(isPressing({ urgent: false, dueDate: d('2026-10-06') }, tomorrow), true)
  assert.equal(isPressing({ urgent: false, dueDate: d('2026-09-30') }, tomorrow), true)
  assert.equal(isPressing({ urgent: false, dueDate: d('2026-10-09') }, tomorrow), false)
  assert.equal(isPressing({ urgent: false, dueDate: d('2026-10-09'), remindDaysBefore: 3 }, tomorrow), true)
  assert.equal(isPressing({ urgent: false, dueDate: null }, tomorrow), false)
})

test('pressing ones float up, urgent first, the rest keep their order', () => {
  const items = [
    { id: 'a', urgent: false, dueDate: null },
    { id: 'b', urgent: false, dueDate: d('2026-10-06') },
    { id: 'c', urgent: false, dueDate: d('2026-12-01') },
    { id: 'd', urgent: true, dueDate: null },
    { id: 'e', urgent: false, dueDate: d('2026-10-01') },
  ]
  assert.deepEqual(pressingFirst(items, tomorrow).map((i) => i.id), ['d', 'e', 'b', 'a', 'c'])
})
