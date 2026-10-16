import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statedNumbers, receiptNeedsYes, heldProblem, heldBlock, HOLD_MS } from '../lib/receipt-gate'
import { ownEmailWords } from '../lib/mouse/team-mail'

// 16 Oct 2026, the shadow bake-off: "PO 2360 arrived in full today." One
// layout logged the White tees at what the PO still owed. Code decides now.

const turn = (words: string[], id = 't2', personId: string | null = 'brandon') => ({ id, personId, words })

test('"arrived in full" states no number, so every receipt waits for a yes', () => {
  const t = turn(['PO 2360 arrived in full today.'])
  for (const q of [510, 245, 85, 2360]) assert.equal(receiptNeedsYes(q, t, '2360'), true)
})

test('a number the person wrote goes straight in', () => {
  const t = turn(['White came in: 510 size 1, 245 size 2, 85 size 3. PO 2360'])
  assert.equal(receiptNeedsYes(510, t, '2360'), false)
  assert.equal(receiptNeedsYes(245, t, '2360'), false)
  assert.equal(receiptNeedsYes(1033, turn(['the cosmo came, 1,033 of them']), '2378'), false)
  assert.equal(receiptNeedsYes(6.25, turn(['1 piece, 6.25 sq ft']), null), false)
})

test('sizes, dates, times, order and PO numbers are not counts', () => {
  assert.deepEqual([...statedNumbers(['PO 2360 size 1 arrived 14 Oct at 11:30am, see #2794'], '2360')], [])
  assert.deepEqual([...statedNumbers(['Oct. 14 and 10/14 and 3 November'])], [])
  assert.deepEqual([...statedNumbers(['12 marigold hides'])], [12])
})

test('no turn means no words: held', () => {
  assert.equal(receiptNeedsYes(10, null), true)
})

const held = {
  type: 'RECEIVED', productVariantId: 'v1', componentId: null, locationId: null, atVendorId: null,
  deltaQty: 510, poNumber: '2360', createdAt: new Date(1_000_000), turnId: 't1', personId: 'brandon', usedAt: null,
}
const call = { type: 'RECEIVED', productVariantId: 'v1', componentId: null, locationId: null, atVendorId: null, deltaQty: 510, poNumber: '2360' }

test('a held line is logged only from a later turn, by the same person, exactly as held', () => {
  const now = 1_000_000 + 60_000
  assert.equal(heldProblem(held, call, turn(['yes']), now), null)
  assert.match(heldProblem(held, call, turn(['yes'], 't1'), now)!, /same turn/)
  assert.match(heldProblem(held, call, turn(['yes'], 't2', 'jane'), now)!, /someone else/)
  assert.match(heldProblem(held, { ...call, deltaQty: 500 }, turn(['yes']), now)!, /for 510, not 500/)
  assert.match(heldProblem(held, { ...call, productVariantId: 'v2' }, turn(['yes']), now)!, /different item/)
  assert.match(heldProblem(held, { ...call, poNumber: '2378' }, turn(['yes']), now)!, /different purchase order/)
  assert.match(heldProblem(held, { ...call, atVendorId: 'vnd_x' }, turn(['yes']), now)!, /different place/)
  assert.match(heldProblem(held, { ...call, type: 'COUNTED' }, turn(['yes']), now)!, /RECEIVED, not a COUNTED/)
  assert.match(heldProblem({ ...held, usedAt: new Date() }, call, turn(['yes']), now)!, /already logged/)
  assert.match(heldProblem(held, call, turn(['yes']), 1_000_000 + HOLD_MS + 1)!, /lapsed/)
  assert.match(heldProblem(held, call, null, now)!, /conversation turn/)
  assert.match(heldProblem(null, call, turn(['yes']), now)!, /no held receipt/)
})

test('the block code adds says plainly nothing is logged', () => {
  assert.equal(heldBlock([]), '')
  assert.match(heldBlock(['PO 2360 · Cleo Tee / White / 1 · 510 received (held x)']), /^Not logged yet\./)
})

test("quoted mail is not the sender's words", () => {
  const body = 'Yes, log it.\n\nOn Thu, Oct 16, 2026 at 9:00 AM Studio Mouse <mouse@send.cleocamp.com> wrote:\n> 510 received on PO 2360'
  assert.equal(statedNumbers([ownEmailWords(body)]).has(510), false)
})

test('a list of sizes is not counts, the counts beside it are', () => {
  assert.deepEqual([...statedNumbers(['sizes 1, 2 and 3: 50 each'])], [50])
  assert.deepEqual([...statedNumbers(['510 size 1, 245 size 2, 85 size 3'])].sort((a, b) => a - b), [85, 245, 510])
})

test('"none left" states a count of zero', () => {
  assert.equal(receiptNeedsYes(0, turn(['Lorena has none left of the black'])), false)
  assert.equal(receiptNeedsYes(0, turn(['count the black at Lorena'])), true)
})
