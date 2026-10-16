import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSame, sameDayRepeats, sameEventSameDay, sameThing, type ListLine } from '../lib/mouse/dupes'

test('the morning of 16 Oct: the Antonio\'s pickup is one line, not three', () => {
  const lines: ListLine[] = [
    { day: '2026-10-16', source: 'po', text: "PO 2360 Antonio's Cleo Tee", poNumber: '2360' },
    { day: '2026-10-16', source: 'calendar', text: "White Cleo Tees ready for pickup at Antonio's, 11:30am (PO 2360)" },
    { day: '2026-10-16', source: 'todo', text: "Collect the White Cleo Tees from Antonio's, Fri 16 Oct from 11:30am (who?)" },
    { day: '2026-10-16', source: 'todo', text: "PO 2410 buttons: get Jane's home address and send it to Best Buttons" },
    { day: '2026-10-16', source: 'po', text: 'PO 2387 L&L this order', poNumber: '2387' },
  ]
  assert.deepEqual([...sameDayRepeats(lines)].sort(), [0, 1], 'the PO line and the calendar entry go; the todo, the buttons and PO 2387 stay')
})

test('only the same day merges, and a PO line stays unless something names that PO', () => {
  const lines: ListLine[] = [
    { day: '2026-10-16', source: 'todo', text: "Collect the White Cleo Tees from Antonio's" },
    { day: '2026-10-17', source: 'calendar', text: "White Cleo Tees ready for pickup at Antonio's" },
    { day: '2026-10-16', source: 'po', text: "PO 2360 Antonio's Cleo Tee", poNumber: '2360' },
  ]
  assert.deepEqual([...sameDayRepeats(lines)], [])
})

test('a new todo that copies an open one is caught; different tasks with shared words are not', () => {
  const open = [
    { id: 'a', title: "Collect the White Cleo Tees from Antonio's, Fri 16 Oct from 11:30am" },
    { id: 'b', title: 'Pay CA LLC annual fee' },
    { id: 'c', title: 'Ship Cosimo\'s second batch: 6 White Cleo Tees, 2 Splish Cleo Tees size 3 and 1 Chocolate Cleo Bag' },
  ]
  assert.equal(findSame("Collect the white Cleo Tees from Antonio's on Friday 11:30am", open)?.id, 'a')
  assert.equal(findSame('Pay CA LLC estimated fee, Form 3536', open), null, 'annual and estimated are two fees')
  assert.equal(findSame('Cosimo: invoice their second wholesale order', open), null, 'shipping and invoicing are two tasks')
  assert.equal(sameThing('Refund order #2614 Boy Belt', 'Refund order #2615 Boy Belt'), false, 'different orders are never the same')
  assert.equal(sameThing('File CA LLC return (Form 568)', 'File CA LLC return (Form 3536)'), false, 'different forms are never the same')
})

test('the same-day test is looser than the copy test, and still refuses a number clash', () => {
  assert.ok(sameEventSameDay("Collect the White Cleo Tees from Antonio's, 11:30am", "White Cleo Tees ready for pickup at Antonio's, 11:30am (PO 2360)"))
  assert.ok(sameThing("Collect the White Cleo Tees from Antonio's, Fri 16 Oct from 11:30am (who?)", "White Cleo Tees ready for pickup at Antonio's, 11:30am (PO 2360)"), 'dates in the wording do not make two tasks of one')
  assert.equal(sameThing('Set aside one Black Cleo Tee size 2 for Ashby', 'Ship Abby\'s gift Black Cleo Tee size 1 (order #2811)'), false)
  assert.equal(sameEventSameDay('Shell buttons from Best Buttons (PO 2410)', 'Shell buttons from Best Buttons (PO 2411)'), false)
})
