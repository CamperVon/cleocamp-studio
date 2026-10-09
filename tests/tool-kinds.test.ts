import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_KINDS } from '../lib/mouse/tool-kinds'
import { TOOLS } from '../lib/mouse/tools'
import { PRACTICE_TOOLS, practiceStop, READ_LANE_LEAVES_TO_OPUS, READ_LANE_TOOLS, toolsFor } from '../lib/mouse/agent'
import { classifyResult } from '../lib/mouse/outcomes'
import { routeChat, type RouteContext } from '../lib/mouse/route'

// The read lane must never make Mouse dumber (Brandon, 8 Oct 2026). Every tool
// is given a kind in lib/mouse/tool-kinds.ts, and these tests hold the lane,
// practice, the write check and the router to it.

const on: RouteContext = { enabled: true, source: 'chat', practice: false, hasAttachments: false, filesInHistory: false, lastReply: 'Done.' }
const kinds = Object.entries(TOOL_KINDS)
const of = (k: string) => kinds.filter(([, v]) => v === k).map(([n]) => n)

test('every tool Mouse has is given a kind, and every kind names a real tool', () => {
  const missing = Object.keys(TOOLS).filter((n) => !(n in TOOL_KINDS))
  assert.deepEqual(missing, [], `give these a kind in lib/mouse/tool-kinds.ts: ${missing.join(', ')}`)
  const unknown = Object.keys(TOOL_KINDS).filter((n) => !(n in TOOLS))
  assert.deepEqual(unknown, [], `no such tool: ${unknown.join(', ')}`)
})

test('the look-ups are pinned: making a tool one runs it in practice and stops it counting as a write', () => {
  // Read the tool before adding it to either list: it must change nothing.
  assert.deepEqual(of('read-lane').sort(), ['check_sent_mail', 'find_contacts', 'find_customer', 'find_in_shopify', 'open_email', 'open_record', 'query_status', 'reorder_math', 'search_chat', 'shipped_orders', 'shopify_analytics', 'unpaid_live_sales'])
  assert.deepEqual(of('look-up, Opus').sort(), ['draft_order_links', 'read_file'])
})

test('the read lane holds exactly the read-lane look-ups, and is offered nothing else', () => {
  assert.deepEqual([...READ_LANE_TOOLS].sort(), of('read-lane').sort())
  assert.deepEqual(toolsFor(undefined, 'thread_1', 'read').sort(), of('read-lane').sort())
  for (const n of of('changes')) assert.ok(!READ_LANE_TOOLS.has(n), `${n} changes things and must stay out of the read lane`)
})

test('every tool a question may need is in the read lane or goes to Opus, never neither and never both', () => {
  for (const [n, k] of kinds) {
    if (k === 'changes') continue
    assert.ok(READ_LANE_TOOLS.has(n) !== READ_LANE_LEAVES_TO_OPUS.has(n), `${n} (${k})`)
  }
  assert.deepEqual([...READ_LANE_LEAVES_TO_OPUS].sort(), [...of('look-up, Opus'), ...of('answers, Opus')].sort())
})

// For each tool the lane lacks, questions a person would ask that need it.
// A tool added to "look-up, Opus" or "answers, Opus" without examples here
// fails, and every example must go to Opus by code, not by Sonnet noticing.
const NEEDS: Record<string, string[]> = {
  read_file: [
    'What does the Calamo colour card say?',
    'Which pdf is the Bean Bag spec sheet?',
    'What is in the photo of the belt?',
    'Who has the tech pack for the tank?',
    'What does the attachment Lorena sent show?',
  ],
  draft_order_links: [
    'Where is the draft order for Natasha?',
    'Is there a payment link for the wholesale invoice?',
    'What is the checkout link for the gift?',
  ],
  muse_tasks: [
    'What did Muse find on zipper suppliers?',
    'Has Muse reported back on the shipping boxes?',
  ],
  stylist_inventory: [
    'What is in the stylist inventory?',
    'How many tees are in stylist stock?',
  ],
  update_line_sheet: [
    'What does the line sheet say under the footnote?',
    'What are the terms on the linesheet?',
  ],
}

test('never dumber: a question needing a tool the read lane lacks goes to Opus by code', () => {
  for (const n of READ_LANE_LEAVES_TO_OPUS) {
    assert.ok(NEEDS[n]?.length, `${n}: add questions that need it to NEEDS, and make the router send them to Opus`)
    for (const m of NEEDS[n]) assert.equal(routeChat(m, on).lane, 'opus', `${n}: "${m}"`)
  }
  for (const n of Object.keys(NEEDS)) assert.ok(READ_LANE_LEAVES_TO_OPUS.has(n), `${n} is not left to Opus`)
})

test('never dumber: a label question reaches Sonnet only with the label tool, or goes to Opus', () => {
  const readTools = toolsFor(undefined, 'thread_1', 'read')
  assert.ok(readTools.includes('shipped_orders'))
  for (const m of [
    'How many black Cleo Tees went out on labels yesterday?',
    'How many orders did Jane buy shipping labels for on 7 Oct?',
    'Which orders got labels today?',
    'How many white tees are on the labels from this morning?',
    "What went out on yesterday's labels?",
  ]) {
    const r = routeChat(m, on)
    assert.ok(r.lane === 'opus' || readTools.includes('shipped_orders'), `${m} → ${r.lane} without the label tool`)
  }
})

test('look-ups run in practice and never count as a write; everything else is stopped and does', () => {
  assert.deepEqual([...PRACTICE_TOOLS].sort(), [...of('read-lane'), ...of('look-up, Opus')].sort())
  for (const n of [...of('read-lane'), ...of('look-up, Opus')]) {
    assert.equal(practiceStop(true, n, {}), null, `${n} runs in practice`)
    assert.equal(classifyResult(n, {}).isWrite, false, `${n} is a look-up, not a write`)
  }
  for (const n of [...of('answers, Opus'), ...of('changes')]) {
    assert.ok(practiceStop(true, n, {}), `${n} is stopped in practice`)
    // The troubleshooting log is not a record of the business (outcomes.ts).
    if (n !== 'note_problem') assert.equal(classifyResult(n, {}).isWrite, true, `${n} counts as a write`)
  }
})
