/**
 * Freeze every variant line on a sent purchase order that is not frozen yet,
 * exactly as it reads under the code that sent it (the old SKU alone; see
 * lib/po-snapshot.ts). Safe to run any number of times: a frozen line is
 * never touched. Run before and after deploying the style system, so an
 * order sent by the old code in between keeps what its vendor received.
 *
 *   npx tsx scripts/freeze-sent-pos.ts
 */
import { db } from '@/lib/db'
import { freezePoLines } from '@/lib/po-snapshot'

async function main() {
  const pos = await db.purchaseOrder.findMany({
    where: { status: { not: 'DRAFT' }, lines: { some: { productVariantId: { not: null }, snapshotAt: null } } },
    select: { id: true, poNumber: true },
  })
  let n = 0
  for (const po of pos) n += (await freezePoLines(po.id, { legacy: true })).length
  console.log(n ? `froze ${n} line${n === 1 ? '' : 's'} on PO ${pos.map((p) => p.poNumber).join(', ')}` : 'every sent PO line was already frozen')
}
main().then(() => process.exit(0))
