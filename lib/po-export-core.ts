import { createHash } from 'node:crypto'

export type SavedExport = { id: string; language: string; createdAt: Date }

/** Dependency-injected so the real workflow can be tested without live services. */
export async function createCleanExport<T extends { id: string; poNumber: string; status: string; language: string }>(
  po: T,
  defaults: unknown,
  deps: {
    find: (purchaseOrderId: string, hash: string) => Promise<SavedExport | null>
    render: (po: T) => Promise<Buffer>
    save: (data: { purchaseOrderId: string; contentHash: string; language: string; pdf: Buffer }) => Promise<SavedExport>
  },
) {
  if (po.status === 'CANCELLED') throw new Error('This order is cancelled. Reopen or replace it before preparing a clean copy.')
  // Hash the inputs, not PDF bytes (PDF creation timestamps differ per render).
  // Bump the renderer version whenever the printed template changes.
  const contentHash = createHash('sha256').update(JSON.stringify({ renderer: 1, po, defaults })).digest('hex')
  let saved = await deps.find(po.id, contentHash)
  if (!saved) {
    const pdf = await deps.render(po)
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The document renderer did not produce a PDF.')
    if (pdf.length > 4 * 1024 * 1024) throw new Error('This PDF is too large to save. Use smaller product photos.')
    saved = await deps.save({ purchaseOrderId: po.id, contentHash, language: po.language, pdf })
  }
  return {
    exportId: saved.id,
    poNumber: po.poNumber,
    language: saved.language,
    createdAt: saved.createdAt.toISOString(),
    documentPath: `/po/${encodeURIComponent(po.poNumber)}/exports/${encodeURIComponent(saved.id)}`,
    orderStatus: po.status,
    emailSent: false,
    exported: true,
    tellTheUser: 'Clean copy saved. You can download and send it yourself. This did not send an email or change the order status. Later edits will not change this saved copy.',
  }
}
