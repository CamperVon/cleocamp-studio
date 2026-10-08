/**
 * Renders every sent purchase order (anything not a draft) as the vendor's
 * PDF (as text) and as the /po page (as HTML), into a folder, so two
 * captures can be compared line for line. Read-only.
 *
 *   npx tsx scripts/po-render-capture.ts <folder>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { db } from '@/lib/db'
import { renderPurchaseOrderPdf } from '@/lib/po-pdf'
import { renderToReadableStream } from 'react-dom/server'
import PurchaseOrderDoc from '@/app/po/[poNumber]/page'

async function html(poNumber: string): Promise<string> {
  const el = await PurchaseOrderDoc({ params: Promise.resolve({ poNumber }) })
  const stream = await renderToReadableStream(el)
  await stream.allReady
  return new Response(stream).text()
}

async function main() {
  const dir = process.argv[2]
  if (!dir) throw new Error('give a folder')
  mkdirSync(dir, { recursive: true })
  const pos = await db.purchaseOrder.findMany({ where: { status: { not: 'DRAFT' } }, select: { poNumber: true }, orderBy: { poNumber: 'asc' } })
  for (const { poNumber } of pos) {
    const pdf = await renderPurchaseOrderPdf(poNumber)
    writeFileSync(`${dir}/${poNumber}.pdf`, pdf!)
    writeFileSync(`${dir}/${poNumber}.pdf.txt`, execFileSync('pdftotext', ['-layout', `${dir}/${poNumber}.pdf`, '-']))
    writeFileSync(`${dir}/${poNumber}.html`, await html(poNumber))
  }
  console.log(`${pos.length} sent POs captured in ${dir}`)
}
main().then(() => process.exit(0))
