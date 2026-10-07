import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownWords, routeChat, type RouteContext } from '../lib/mouse/route'

// Synthetic wording throughout; nothing here is real data.
const on: RouteContext = { enabled: true, source: 'chat', practice: false, hasAttachments: false, filesInHistory: false, lastReply: 'Done.' }
const lane = (m: string, ctx: Partial<RouteContext> = {}) => routeChat(m, { ...on, ...ctx }).lane

test('must go to Opus: actions, facts, answers, joined requests, overrides, judgement', () => {
  const opus: Array<[string, Partial<RouteContext>?]> = [
    ['Send 2398 and cc the crew'],
    ['they came from the dye house', { lastReply: 'Where did they come from?' }],
    ['todo for jane'],
    ['4x'],
    ['there are 10 skirts in the studio, XS 0, S 1'],
    ['found the missing large, keep the original count of 11'],
    ['change magnet vendor: Amazing Magnets'],
    ['these were sent to Lorena today'],
    ['Clarifying: newsprint is not used with the tees.'],
    ['How many skirts do we have? also log 2 more'],
    ["What's on PO 2391 and can you mark it received?"],
    ['Is the Calamo PO paid?'],
    ['Think hard: how many tees for October?'],
    ["use opus, what's the lead time at Empire?"],
    ["Can you check what Antonio's owes us?"],
    ['Remind me what the Bean Bag costs to make'],
    ['What should we reorder this week?'],
    ['what is this?', { hasAttachments: true }],
    ['what does it say on page 2?', { filesInHistory: true }],
    ['black', { lastReply: 'Which colour?' }],
    ['Who has the hangtags — move 500 to Empire'],
    ['Why is the Cleo Tee showing oversold?'],
    ['pls updte the price'],
    ['¿cuántas camisetas tenemos?'],
    ['Hi team,\nWhat is the lead time on the organza?\nThanks'],
    ['How many skirts are at the studio? ' + 'x'.repeat(200)],
    ['(Typed in the box on the Products page.) How many skirts are at the studio?'],
  ]
  for (const [m, ctx] of opus) assert.equal(lane(m, ctx), 'opus', m)
})

test('irregular action forms go to Opus: paid, sent, received, made, bought, gave, used', () => {
  const cases: Array<[string, string]> = [
    ['Is the Calamo PO paid?', 'verb:paid'],
    ['Has the PO been sent?', 'verb:sent'],
    ['Was PO 2391 received?', 'verb:received'],
    ['Where is the Bateau handle made?', 'verb:made'],
    ['What was bought from Calamo?', 'verb:bought'],
    ['Who gave the stylist the belt?', 'verb:gave'],
    ['Which tees used the newsprint?', 'verb:used'],
  ]
  for (const [m, reason] of cases) assert.deepEqual(routeChat(m, on), { lane: 'opus', reason }, m)
})

test('plain look-up questions may take the read lane', () => {
  for (const m of [
    'How many skirts are at the studio?',
    'When is the Cosmo Stripe run due?',
    'Which vendors are in Los Angeles?',
    'Do we have links for the Weaver snaps?',
    'What did Jane say about the newsprint?',
    'How much is the Bean Bag wholesale?',
    'Who sews the Cleo Bag?',
    'Is the Story Dress in stock in size 1?',
    '[Cleo, owner] How many skirts are at the studio?',
  ]) assert.deepEqual(routeChat(m, on), { lane: 'read', reason: 'read-eligible' }, m)
})

test('known, accepted cases where a plain question still goes to Opus (costs money, never safety)', () => {
  assert.equal(routeChat("What's on order from Calamo?", on).reason, 'verb:order')
  assert.equal(routeChat("What's in Files for Calamo?", on).reason, 'verb:files')
  assert.equal(routeChat('Which vendors have no email on file?', on).lane, 'opus')
})

test('only interactive chat, with the switch on, outside practice, can use the read lane', () => {
  const q = 'How many skirts are at the studio?'
  assert.deepEqual(routeChat(q, { ...on, enabled: false }), { lane: 'opus', reason: 'switch-off' })
  assert.equal(routeChat(q, { ...on, source: 'say' }).reason, 'source:say')
  assert.equal(routeChat(q, { ...on, source: 'chat-practice', practice: true }).lane, 'opus')
  assert.equal(routeChat(q, { ...on, practice: true }).reason, 'practice')
})

test("the person's own words are read, not the author or page prefix", () => {
  assert.deepEqual(ownWords('[Jane, studio] (Typed in the box on the Vendors page.) Who sews it?'), { text: 'Who sews it?', fromPageBox: true })
  assert.deepEqual(ownWords('Who sews it?'), { text: 'Who sews it?', fromPageBox: false })
})
