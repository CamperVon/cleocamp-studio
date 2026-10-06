import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  type NoteRow, type RecordRef,
  mentionedRecords, noteLine, prefetchBlock, renderNotesFull, renderNotesIndex, resolveRecord,
} from '../lib/mouse/notes'
import { boundNotes } from '../lib/mouse/stale-notes'
import { turnContent } from '../lib/mouse/agent'

// Synthetic records and notes; nothing here is real data.
const dir: RecordRef[] = [
  { kind: 'product', id: 'prd_tee', name: 'Test Tee', keys: ['prd_tee', 'Test Tee'] },
  { kind: 'component', id: 'cmp_tag', name: 'Test Tee hangtag', keys: ['cmp_tag', 'Test Tee hangtag'] },
  { kind: 'component', id: 'cmp_denim', name: 'Denim', keys: ['cmp_denim', 'Denim'] },
  { kind: 'vendor', id: 'vnd_mill', name: 'North Mill', keys: ['vnd_mill', 'North Mill', 'North Mill Textiles LLC'] },
  { kind: 'purchase order', id: 'po_1', name: 'PO 9001 · North Mill', keys: ['po_1', '9001', 'PO 9001'] },
  // Two different records with the same exact name.
  { kind: 'component', id: 'cmp_twin', name: 'Twin Label', keys: ['cmp_twin', 'Twin Label'] },
  { kind: 'wholesale account', id: 'ws_twin', name: 'Twin Label', keys: ['ws_twin', 'Twin Label'] },
  { kind: 'note subject', id: 'stylists', name: 'stylists', keys: ['stylists'] },
]
const at = (iso: string) => new Date(`${iso}T12:00:00Z`)
const CORRECTION = 'CORRECTION: the rate is NOT $3.75 per piece. Brandon disputed it on 15 Sept. ' + 'Details of the dispute follow. '.repeat(180) + 'FINAL SENTENCE: use $3.25.'
const notes: NoteRow[] = [
  { id: 'n1', entityType: 'PURCHASE_ORDER', entityId: 'po_1', content: 'Rush: ship by Friday.', createdAt: at('2026-10-05') },
  { id: 'n2', entityType: 'VENDOR', entityId: 'vnd_mill', content: CORRECTION, createdAt: at('2026-10-04') },
  { id: 'n3', entityType: 'COMPONENT', entityId: 'cmp_tag', content: 'Counted 2,100 in the studio.', createdAt: at('2026-09-16') },
  { id: 'n4', entityType: 'PRODUCT', entityId: 'prd_tee', content: 'Small is 59% of orders; weight runs to Small.', createdAt: at('2026-09-20') },
  { id: 'n5', entityType: 'GENERAL', entityId: null, content: 'Always cc the studio on vendor mail.', createdAt: at('2026-09-01') },
  { id: 'n6', entityType: 'GENERAL', entityId: 'stylists', content: 'Stylist pulls come back within two weeks.', createdAt: at('2026-09-02') },
  { id: 'n7', entityType: 'PURCHASE_ORDER', entityId: 'po_old', content: 'Old order, received.', createdAt: at('2026-08-01') },
]
const latest = new Map([['cmp_tag', at('2026-09-25')]])
const notesFor = (r: RecordRef) => notes.filter((n) => r.keys.includes(n.entityId ?? ''))
const section = { notes, openPoKeys: new Set(['po_1', '9001', 'PO 9001']), nameOf: new Map(dir.map((r) => [r.id, r.name])), latestCount: latest }

test('exact PO, vendor, component and product references find the one record', () => {
  for (const ref of ['PO 9001', 'po #9001', '9001', 'po_1']) assert.equal((resolveRecord(ref, dir) as { record: RecordRef }).record.id, 'po_1', ref)
  assert.equal((resolveRecord('North Mill', dir) as { record: RecordRef }).record.id, 'vnd_mill')
  assert.equal((resolveRecord('north   mill textiles llc', dir) as { record: RecordRef }).record.id, 'vnd_mill')
  assert.equal((resolveRecord('Test Tee hangtag', dir) as { record: RecordRef }).record.id, 'cmp_tag')
  assert.equal((resolveRecord('test tee', dir) as { record: RecordRef }).record.id, 'prd_tee')
  assert.equal(resolveRecord('Test', dir).status, 'none')
  assert.equal(resolveRecord('Twin Label', dir).status, 'ambiguous')
})

test('the full notes for an exact reference come back whole, correction included', () => {
  const r = (resolveRecord('North Mill', dir) as { record: RecordRef }).record
  const lines = notesFor(r).map((n) => noteLine(n, latest))
  assert.equal(lines.length, 1)
  assert.ok(lines[0].startsWith('[n2] CORRECTION'))
  assert.ok(lines[0].endsWith('FINAL SENTENCE: use $3.25.'))
  assert.ok(lines[0].length > 5000)
})

test('stale-count warnings stay on retrieved notes', () => {
  assert.match(noteLine(notes[2], latest), /WRITTEN BEFORE THE LATEST COUNT/)
  assert.doesNotMatch(noteLine(notes[3], latest), /WRITTEN BEFORE/) // no count words
  assert.doesNotMatch(noteLine({ ...notes[2], createdAt: at('2026-09-30') }, latest), /WRITTEN BEFORE/) // newer than the count
})

test('prefetch: exact PO and vendor names in a message bring their notes in full', () => {
  const m = mentionedRecords('Has PO 9001 shipped from North Mill yet?', dir)
  assert.deepEqual(m.found.map((r) => r.id).sort(), ['po_1', 'vnd_mill'])
  const block = prefetchBlock(m, notesFor, latest)!
  assert.ok(block.includes('Rush: ship by Friday.'))
  assert.ok(block.includes('FINAL SENTENCE: use $3.25.')) // never cut
  assert.match(block, /not from the person/)
})

test('prefetch: the longer exact name wins, and parts of words do not match', () => {
  assert.deepEqual(mentionedRecords('count the Test Tee hangtag please', dir).found.map((r) => r.id), ['cmp_tag'])
  assert.deepEqual(mentionedRecords('Denimwear is not denim-ish', dir).found, [])
  assert.deepEqual(mentionedRecords('order more denim', dir).found.map((r) => r.id), ['cmp_denim'])
})

test('ambiguous names do not prefetch either record', () => {
  const m = mentionedRecords('Invoice Twin Label for the samples', dir)
  assert.deepEqual(m.found, [])
  assert.equal(m.ambiguous.length, 1)
  const block = prefetchBlock(m, notesFor, latest)!
  assert.match(block, /names more than one record, so none was looked up/)
  assert.ok(block.includes('[cmp_twin]') && block.includes('[ws_twin]'))
})

test('an ordinary unrelated question gets no notes and no lookup', () => {
  const m = mentionedRecords('How many units did we sell yesterday?', dir)
  assert.deepEqual(m, { found: [], ambiguous: [] })
  assert.equal(prefetchBlock(m, notesFor, latest), null)
  // An everyday word that is also a free-text note subject preloads nothing.
  assert.deepEqual(mentionedRecords('Any news from the stylists?', dir).found, [])
})

test('the index carries no record note text, lists every subject, and keeps general notes whole', () => {
  const idx = renderNotesIndex(section).join('\n')
  for (const n of notes.filter((x) => x.entityId && x.entityId !== 'po_old')) assert.ok(!idx.includes(n.content.slice(0, 20)), n.id)
  assert.match(idx, /North Mill \[vnd_mill\]: 1 note, newest/)
  assert.match(idx, /PO 9001 · North Mill \[po_1\]: 1 note/)
  assert.match(idx, /Test Tee hangtag \[cmp_tag\]: 1 note, newest .* · 1 written before the latest count/)
  assert.match(idx, /stylists \[stylists\]: 1 note/)
  assert.ok(idx.includes('[n5] Always cc the studio on vendor mail.'))
  assert.match(idx, /1 note on received or cancelled orders not listed/)
  assert.match(idx, /open_record/)
})

test('every current note is either in full or under a subject the index lists', () => {
  const idx = renderNotesIndex(section).join('\n')
  for (const n of notes) {
    if (n.entityId === 'po_old') continue // closed order: reachable via query_status, as before
    const whole = idx.includes(`[${n.id}] ${n.content}`)
    const listed = !!n.entityId && idx.includes(`[${n.entityId}]:`)
    assert.ok(whole || listed, n.id)
  }
})

test('the full path still prints every note whole (background runs, and the reference)', () => {
  const full = renderNotesFull(section).join('\n')
  for (const n of notes.filter((x) => x.entityId !== 'po_old')) assert.ok(full.includes(`[${n.id}] ${n.content.replace(/\s+/g, ' ')}`), n.id)
  assert.match(full, /WRITTEN BEFORE THE LATEST COUNT/)
})

test('prefetch takes whole records only: one that does not fit is listed to open, never cut', () => {
  const m = { found: [dir[3], dir[4]], ambiguous: [] }
  const block = prefetchBlock(m, notesFor, latest, 1_000)!
  assert.ok(block.includes('FINAL SENTENCE: use $3.25.')) // first record always whole, even over budget
  assert.match(block, /PO 9001 · North Mill \[po_1\] \(purchase order\) also has notes: read them with open_record/)
  assert.ok(!block.includes('Rush: ship by Friday.'))
})

test('notes on what a write changed: whole notes up to the limit, the rest by id', () => {
  const r = boundNotes([{ id: 'a', content: CORRECTION }, { id: 'b', content: 'short' }], 3_000)
  assert.equal(r.shown[0].text, CORRECTION) // never cut, even alone over the limit
  assert.deepEqual(r.more, ['b'])
  assert.deepEqual(boundNotes([{ id: 'a', content: 'x' }, { id: 'b', content: 'y' }]).more, [])
})

test("the person's words stay their own block; the lookup rides separately", () => {
  assert.equal(turnContent('Lorena got 2 hides', []), 'Lorena got 2 hides')
  const c = turnContent('Lorena got 2 hides', [], '[The app looked up…]') as Array<{ type: string; text: string }>
  assert.deepEqual(c.map((b) => b.text), ['Lorena got 2 hides', '[The app looked up…]'])
})
