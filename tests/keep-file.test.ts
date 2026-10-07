import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseChatAttachment, keepChatFile, storedFileData, uploadFromForm, type ChatFile } from '../lib/files'
import { CHAT_ONLY_TOOLS, toolsFor } from '../lib/mouse/agent'
import { TOOLS } from '../lib/mouse/tools'

// Synthetic attachments; nothing here is real data.
const now = new Date('2026-10-07T18:00:00Z')
const ago = (min: number) => new Date(+now - min * 60_000)
const file = (threadId: string, filename: string, min: number, data: string | null = 'JVBERi0x'): ChatFile => ({ threadId, filename, mediaType: 'application/pdf', data, createdAt: ago(min) })
const fakeKeep = () => {
  const calls: Array<Record<string, unknown>> = []
  const keep = async (input: Record<string, unknown>) => { calls.push(input); return { ok: true as const, id: 'f_new' } }
  return { calls, keep: keep as never }
}

test('an attachment in another thread is never chosen, even a newer one with the same filename', () => {
  const candidates = [file('other', 'card.pdf', 1, 'OTHER'), file('mine', 'card.pdf', 10, 'MINE')]
  const byName = chooseChatAttachment('mine', candidates, 'card.pdf', now) as { file: ChatFile }
  assert.equal(byName.file.data, 'MINE')
  const newest = chooseChatAttachment('mine', candidates, null, now) as { file: ChatFile }
  assert.equal(newest.file.data, 'MINE')
  // The other thread's file is the only one: nothing is chosen.
  assert.match((chooseChatAttachment('mine', [file('other', 'card.pdf', 1)], 'card.pdf', now) as { error: string }).error, /this chat/)
})

test('the half-hour window and filename disambiguation still hold', () => {
  assert.ok('error' in chooseChatAttachment('mine', [file('mine', 'old.pdf', 31)], null, now))
  assert.ok('error' in chooseChatAttachment('mine', [file('mine', 'cleared.pdf', 2, null)], null, now)) // bytes already cleared
  const two = [file('mine', 'a.pdf', 1), file('mine', 'b.pdf', 1.5)]
  assert.match((chooseChatAttachment('mine', two, null, now) as { error: string }).error, /More than one file was just sent/)
  assert.equal((chooseChatAttachment('mine', two, 'b.pdf', now) as { file: ChatFile }).file.filename, 'b.pdf')
})

test('no attachment in the current thread: nothing is saved, and the person is asked to attach it again', async () => {
  const k = fakeKeep()
  const r = await keepChatFile('mine', { title: 'Card' }, { find: async () => [file('other', 'card.pdf', 1)], keep: k.keep })
  assert.equal(r.kept, false)
  assert.match(String((r as { reason: string }).reason), /attach it again/)
  assert.equal(k.calls.length, 0)
})

test('with no chat thread at all, nothing is looked up and nothing is saved', async () => {
  const k = fakeKeep()
  let looked = false
  const r = await keepChatFile(undefined, { title: 'Card' }, { find: async () => { looked = true; return [file('mine', 'card.pdf', 1)] }, keep: k.keep })
  assert.equal(r.kept, false)
  assert.equal(looked, false)
  assert.equal(k.calls.length, 0)
})

test("a file sent in the current thread is kept, with its title, notes and links", async () => {
  const k = fakeKeep()
  const r = await keepChatFile('mine', { title: 'Calamo card', notes: 'Our colours marked', links: [{ kind: 'vendor', id: 'v1' }] },
    { find: async (t) => [file(t, 'card.pdf', 2, 'MINE'), file('other', 'card.pdf', 1, 'OTHER')], keep: k.keep })
  assert.equal(r.kept, true)
  assert.equal(k.calls.length, 1)
  assert.equal(k.calls[0].base64, 'MINE')
  assert.equal(k.calls[0].notes, 'Our colours marked')
  assert.deepEqual(k.calls[0].links, [{ kind: 'vendor', recordId: 'v1' }])
})

test('keep_file is for interactive chat only', async () => {
  assert.ok(CHAT_ONLY_TOOLS.has('keep_file'))
  // The default set (nightly pass, team email, in-flight, answering a to-do) and an explicit list alike.
  assert.ok(!toolsFor(undefined, undefined).includes('keep_file'))
  assert.ok(!toolsFor(['keep_file', 'open_record'], undefined).includes('keep_file'))
  assert.ok(toolsFor(['keep_file', 'open_record'], undefined).includes('open_record'))
  assert.ok(toolsFor(undefined, 'thread_1').includes('keep_file'))
  // Called with no thread anyway (a direct run outside chat), it refuses before touching anything.
  const r = (await TOOLS.keep_file.run({ title: 'Card' })) as { kept: boolean; reason: string }
  assert.equal(r.kept, false)
  assert.match(r.reason, /only be kept from a chat/)
})

test('upload notes are sent on to be saved, and saved', async () => {
  const k = fakeKeep()
  const form = new FormData()
  form.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'card.pdf', { type: 'application/pdf' }))
  form.set('title', 'Calamo card')
  form.set('notes', '  Scanned 6 Oct; pages 2 and 4 upside down  ')
  form.set('links', '[]')
  assert.deepEqual(await uploadFromForm(form, k.keep), { ok: true, id: 'f_new' })
  assert.equal(k.calls[0].notes, '  Scanned 6 Oct; pages 2 and 4 upside down  ')
  // What keepFile writes to the row.
  const row = storedFileData({ title: 'Calamo card', filename: 'card.pdf', mediaType: 'application/pdf', base64: 'x', sizeBytes: 4, notes: k.calls[0].notes as string })
  assert.equal(row.notes, 'Scanned 6 Oct; pages 2 and 4 upside down')
  assert.equal(storedFileData({ title: 't', filename: 'f', mediaType: 'application/pdf', base64: 'x', sizeBytes: 1, notes: '   ' }).notes, null)
})
