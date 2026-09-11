import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('every migration applies in order to an isolated Postgres', async () => {
  // In-memory Postgres. It never reads DATABASE_URL or opens a network connection.
  const db = new PGlite()
  try {
    const root = new URL('../prisma/migrations/', import.meta.url)
    const folders = (await readdir(root, { withFileTypes: true })).filter(f => f.isDirectory()).map(f => f.name).sort()
    for (const folder of folders) await db.exec(await readFile(new URL(`${folder}/migration.sql`, root), 'utf8'))

    await db.exec(`
      INSERT INTO "Vendor" (id, name) VALUES ('test-vendor', 'Synthetic supplier');
      INSERT INTO "PurchaseOrder" (id, "poNumber", "vendorId") VALUES ('test-po', 'TEST-1', 'test-vendor');
      INSERT INTO "ChatThread" (id) VALUES ('test-thread');
      INSERT INTO "ChatMessage" (id, "threadId", role, content, "agentUsageJson")
      VALUES ('test-message', 'test-thread', 'ASSISTANT', 'Test reply', '{"stopReason":"complete","requests":[]}');
    `)

    // A new order starts as an unsent draft and moves nothing on its own.
    assert.deepEqual((await db.query('SELECT status, "orderedAt" FROM "PurchaseOrder"')).rows, [{ status: 'DRAFT', orderedAt: null }])
    assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "InventoryEvent"')).rows[0].count, 0)
    assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "SentEmail"')).rows[0].count, 0)

    // PurchaseOrderExport was dropped on 11 Sept when the clean-copy export
    // was removed; the migration chain above must actually leave it gone.
    const leftovers = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_name = 'PurchaseOrderExport'`,
    )
    assert.equal(leftovers.rows[0].count, 0)
  } finally { await db.close() }
})
