import { db } from '@/lib/db'
import { createCleanExport } from '@/lib/po-export-core'
import { loadPo, renderPoSnapshot } from '@/lib/po-pdf'

export async function exportPurchaseOrder(poNumber: string) {
  const [po, defaults] = await Promise.all([
    loadPo(poNumber),
    db.documentDefaults.findUnique({ where: { id: 'singleton' } }),
  ])
  if (!po) throw new Error(`No purchase order ${poNumber}`)
  const select = { id: true, language: true, createdAt: true } as const
  return createCleanExport(po, defaults, {
    find: (purchaseOrderId, contentHash) => db.purchaseOrderExport.findUnique({
      where: { purchaseOrderId_contentHash: { purchaseOrderId, contentHash } }, select,
    }),
    render: (snapshot) => renderPoSnapshot(snapshot, defaults, { clean: true }),
    // Concurrent clicks reuse the same saved copy. Existing bytes are immutable.
    save: (data) => db.purchaseOrderExport.upsert({
      where: { purchaseOrderId_contentHash: { purchaseOrderId: data.purchaseOrderId, contentHash: data.contentHash } },
      create: { ...data, pdf: new Uint8Array(data.pdf) }, update: {}, select,
    }),
  })
}
