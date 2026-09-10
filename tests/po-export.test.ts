import assert from 'node:assert/strict'
import test from 'node:test'
import { createCleanExport, type SavedExport } from '../lib/po-export-core'

const po = { id: 'test-po', poNumber: 'TEST-1', status: 'DRAFT', language: 'en', quantity: 200 }
function fixture() {
  const saved = new Map<string, SavedExport & { pdf: Buffer }>()
  let renders = 0
  return {
    saved,
    get renders() { return renders },
    deps: {
      find: async (_id: string, hash: string) => saved.get(hash) ?? null,
      render: async (p: typeof po) => { renders++; return Buffer.from(`%PDF-${p.quantity}-${p.language}`) },
      save: async (data: { contentHash: string; language: string; pdf: Buffer }) => {
        const row = { ...data, id: `copy-${saved.size + 1}`, createdAt: new Date('2026-09-10T12:00:00Z') }
        saved.set(data.contentHash, row)
        return row
      },
    },
  }
}

test('export creates a clean copy without changing status; repeat reuses it', async () => {
  const f = fixture()
  const first = await createCleanExport(po, {}, f.deps)
  const second = await createCleanExport(po, {}, f.deps)
  assert.equal(first.exportId, second.exportId)
  assert.equal(f.renders, 1)
  assert.equal(po.status, 'DRAFT')
  assert.equal(first.emailSent, false)
  assert.equal(first.documentPath, '/po/TEST-1/exports/copy-1')
})

test('revisions and language changes save new copies without changing prior bytes', async () => {
  const f = fixture()
  await createCleanExport(po, {}, f.deps)
  const old = [...f.saved.values()][0].pdf.toString()
  await createCleanExport({ ...po, quantity: 240 }, {}, f.deps)
  await createCleanExport({ ...po, quantity: 240, language: 'es' }, {}, f.deps)
  assert.equal(f.saved.size, 3)
  assert.equal([...f.saved.values()][0].pdf.toString(), old)
})

test('document defaults participate in copy identity', async () => {
  const f = fixture()
  await createCleanExport(po, { contact: 'Brandon' }, f.deps)
  await createCleanExport(po, { contact: 'Nicki' }, f.deps)
  assert.equal(f.saved.size, 2)
})

test('failed rendering leaves no saved record', async () => {
  const f = fixture()
  await assert.rejects(createCleanExport(po, {}, { ...f.deps, render: async () => { throw new Error('font missing') } }), /font missing/)
  assert.equal(f.saved.size, 0)
  assert.equal(po.status, 'DRAFT')
})

test('cancelled orders and non-PDF render results cannot become clean copies', async () => {
  const f = fixture()
  await assert.rejects(createCleanExport({ ...po, status: 'CANCELLED' }, {}, f.deps), /cancelled/)
  await assert.rejects(createCleanExport(po, {}, { ...f.deps, render: async () => Buffer.from('error page') }), /did not produce a PDF/)
  assert.equal(f.saved.size, 0)
})
