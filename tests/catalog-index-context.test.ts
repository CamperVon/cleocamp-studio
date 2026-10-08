import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toolContextFor } from '../lib/mouse/agent'

// Phase 2B: the full catalogue entry on open_record (and prefetch) is asked
// for by run context, never by reading MOUSE_CATALOG_INDEX. Only a chat turn
// in index mode asks; every background run reads records as it always did,
// whatever the switch says.

const withSwitchOn = async (fn: () => Promise<void> | void) => {
  const was = process.env.MOUSE_CATALOG_INDEX
  process.env.MOUSE_CATALOG_INDEX = '1'
  try { await fn() } finally {
    if (was === undefined) delete process.env.MOUSE_CATALOG_INDEX
    else process.env.MOUSE_CATALOG_INDEX = was
  }
}

test('only a chat turn in index mode gets catalogIndex in its tool context, switch on or not', () => withSwitchOn(() => {
  assert.deepEqual(toolContextFor({}), { threadId: undefined }, 'background run')
  assert.deepEqual(toolContextFor({ catalog: 'index' }), { threadId: undefined }, 'no thread: not chat, even if index were asked')
  assert.deepEqual(toolContextFor({ chatThreadId: 't1' }), { threadId: 't1' }, 'chat in full mode')
  assert.deepEqual(toolContextFor({ chatThreadId: 't1', catalog: 'full' }), { threadId: 't1' })
  assert.deepEqual(toolContextFor({ chatThreadId: 't1', catalog: 'index' }), { threadId: 't1', catalogIndex: true })
}))

// The calls themselves, read-only, against whatever database this machine
// points at. Skipped where there is none.
const hasDb = !!process.env.DATABASE_URL

test('with MOUSE_CATALOG_INDEX=1, a background open_record call has no added catalogue payload', { skip: !hasDb && 'no DATABASE_URL' }, () => withSwitchOn(async () => {
  const { db } = await import('../lib/db')
  const { TOOLS } = await import('../lib/mouse/tools')
  const { openRecord } = await import('../lib/mouse/records')
  const product = await db.product.findFirst({ orderBy: { name: 'asc' }, select: { id: true } })
  const component = await db.component.findFirst({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true } })
  assert.ok(product && component, 'needs at least one product and one active component')

  for (const id of [product.id, component.id]) {
    // A background run: no context at all, or the context every non-chat run gets.
    for (const ctx of [undefined, toolContextFor({}), toolContextFor({ catalog: 'index' })]) {
      const r = await TOOLS.open_record.run({ ref: id }, ctx) as Record<string, unknown>
      assert.equal(r.found, true)
      assert.ok(!('catalogue' in r) && !('catalogueNote' in r), `no catalogue payload for ${id} with ctx ${JSON.stringify(ctx)}`)
    }
    // Callers outside the tool loop (Muse's answerer) call openRecord with the ref alone.
    const direct = await openRecord(id)
    assert.ok(!('catalogue' in direct), `openRecord(${id}) alone adds nothing`)
    // A chat turn in index mode is the only one that gets it.
    const chat = await TOOLS.open_record.run({ ref: id }, toolContextFor({ chatThreadId: 't1', catalog: 'index' })) as Record<string, unknown>
    assert.ok(Array.isArray(chat.catalogue) && (chat.catalogue as string[]).length > 0, `chat index turn gets the entry for ${id}`)
    // Everything else in the result is the same either way.
    assert.deepEqual(Object.keys(chat).filter((k) => k !== 'catalogue' && k !== 'catalogueNote'), Object.keys(direct))
  }
}))

test('with MOUSE_CATALOG_INDEX=1, prefetch without the chat option is the phase 2A block', { skip: !hasDb && 'no DATABASE_URL' }, () => withSwitchOn(async () => {
  const { db } = await import('../lib/db')
  const { prefetchForMessage } = await import('../lib/mouse/records')
  const product = await db.product.findFirst({ where: { name: { not: '' } }, orderBy: { name: 'asc' }, select: { name: true } })
  const out = await prefetchForMessage(`about the ${product!.name}`)
  assert.ok(out === null || !/\), complete$/m.test(out), 'no full entries unless chat asks')
  assert.ok(out === null || !out.includes('full catalogue entry'))
}))
