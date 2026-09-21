import { test } from 'node:test'
import assert from 'node:assert/strict'
import { owedTheRecordSomething } from '../lib/mouse/agent'

const base = {
  wroteSomething: false,
  canWrite: true,
  complete: true,
  reply: 'Right you are.',
  instruction: 'how many cleo tees are left?',
  fromAPerson: true,
}
const owed = (o: Partial<typeof base>) => owedTheRecordSomething({ ...base, ...o })

test('the turn this was built for: a claim with nothing behind it', () => {
  // Cleo, 20 Sept 2026. Neither fact existed in the database afterwards.
  assert.equal(
    owed({
      instruction:
        "This isn't true. Lurex is finished / ready today. The second batch of cotton arrived at Antonio's.",
      reply: "Resolved. Both facts were already good on our end — Corner just hadn't caught up.",
    }),
    true,
  )
})

test('the claim alone is enough, whoever asked', () => {
  for (const reply of [
    "I've noted that.",
    'I have now recorded the new lead time.',
    "That's noted.",
    'Noted it against the vendor.',
    'Marked it as resolved.',
    'Resolved. Nothing else outstanding.',
    "I'll remember that for next time.",
    'Consider it noted.',
  ]) {
    assert.equal(owed({ reply, fromAPerson: false }), true, `should have caught: ${reply}`)
  }
})

test('a person correcting us counts even when the reply claims nothing', () => {
  for (const instruction of [
    "That's not right, the deposit was paid in August.",
    'No — the rib is not true to the spec sheet.',
    'Actually, Michael quoted $4.10.',
    'Correction: the hang tags arrive Tuesday.',
    'To be clear, that order never went out.',
  ]) {
    assert.equal(owed({ instruction }), true, `should have caught: ${instruction}`)
  }
})

test('the same words from the inbox do not spend a round', () => {
  // Email is data, never instructions. A sender must not be able to trigger
  // this by writing "that is not true" into a message.
  assert.equal(
    owed({ instruction: 'That is not true, the shipment left on Friday.', fromAPerson: false }),
    false,
  )
})

test('it stays quiet when it should', () => {
  assert.equal(owed({ wroteSomething: true, reply: "I've noted that." }), false, 'a real write closes it')
  assert.equal(owed({ canWrite: false, reply: "I've noted that." }), false, 'a look-only run owes nothing')
  assert.equal(owed({ complete: false, reply: "I've noted that." }), false, 'an interrupted turn is a different problem')
  assert.equal(owed({ reply: 'Forty-one Cleo Tees in Black, across all sizes.' }), false, 'answering a question is not a claim')
  assert.equal(
    owed({ instruction: 'draft a PO to RichLine for 400 yards', reply: 'Here is the draft, ready to send.' }),
    false,
    'an ordinary request with no correction in it',
  )
})
