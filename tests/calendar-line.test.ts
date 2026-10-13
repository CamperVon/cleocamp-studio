import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarLine } from '../lib/mouse/context'

const day = new Date('2026-10-15T19:00:00Z')

test('an entry Mouse made shows its id, so a wrong one can be deleted', () => {
  assert.equal(calendarLine({ id: 'cal_1', date: day, title: 'Silk arrives at Lorena\'s', type: 'DELIVERY_EXPECTED', source: 'STUDIO_MOUSE', notes: 'PO 9001\n ground' }),
    '- 2026-10-15 Silk arrives at Lorena\'s [PICKUP/DELIVERY] [cal_1] — PO 9001 ground')
  assert.equal(calendarLine({ id: 'cal_2', date: day, title: 'Reminder', type: 'OTHER', source: 'STUDIO_MOUSE', notes: null }), '- 2026-10-15 Reminder [cal_2]')
})

test('a studio calendar entry shows no id: deleting it would not stick', () => {
  assert.equal(calendarLine({ id: 'g_1', date: day, title: 'Team meeting', type: 'OTHER', source: 'GOOGLE', notes: null }), '- 2026-10-15 Team meeting (studio calendar)')
})
