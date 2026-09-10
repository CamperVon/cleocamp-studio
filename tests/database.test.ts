import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createCleanExport, type SavedExport } from '../lib/po-export-core'

test('all migrations apply to isolated Postgres; exported bytes and order state survive retries', async () => {
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
    let sequence = 0
    const po = { id: 'test-po', poNumber: 'TEST-1', status: 'DRAFT', language: 'en', quantity: 200 }
    const deps = {
      find: async (id: string, hash: string) => (await db.query<SavedExport>(
        'SELECT id, language, "createdAt" FROM "PurchaseOrderExport" WHERE "purchaseOrderId"=$1 AND "contentHash"=$2', [id, hash],
      )).rows[0] ?? null,
      render: async (p: typeof po) => Buffer.from(`%PDF-${p.quantity}-${p.language}`),
      save: async (d: { purchaseOrderId: string; contentHash: string; language: string; pdf: Buffer }) => (await db.query<SavedExport>(
        `INSERT INTO "PurchaseOrderExport" (id, "purchaseOrderId", "contentHash", language, pdf)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("purchaseOrderId", "contentHash")
         DO UPDATE SET "contentHash"=EXCLUDED."contentHash" RETURNING id, language, "createdAt"`,
        [`test-copy-${++sequence}`, d.purchaseOrderId, d.contentHash, d.language, d.pdf],
      )).rows[0],
    }
    const first = await createCleanExport(po, {}, deps)
    const retries = await Promise.all([createCleanExport(po, {}, deps), createCleanExport(po, {}, deps)])
    assert.ok(retries.every(r => r.exportId === first.exportId))
    const revised = await createCleanExport({ ...po, quantity: 240 }, {}, deps)
    assert.notEqual(first.exportId, revised.exportId)
    const stored = await db.query<{ pdf: Uint8Array }>('SELECT pdf FROM "PurchaseOrderExport" WHERE id=$1', [first.exportId])
    assert.equal(Buffer.from(stored.rows[0].pdf).toString(), '%PDF-200-en')
    assert.deepEqual((await db.query('SELECT status, "orderedAt" FROM "PurchaseOrder"')).rows, [{ status: 'DRAFT', orderedAt: null }])
    assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "InventoryEvent"')).rows[0].count, 0)
    assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "SentEmail"')).rows[0].count, 0)
    await assert.rejects(db.query('DELETE FROM "PurchaseOrder" WHERE id=$1', [po.id]), /foreign key/)
  } finally { await db.close() }
})
