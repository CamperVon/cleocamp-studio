import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { renderPoSnapshot, type PoForPdf } from '../lib/po-pdf'

// This exercises the actual renderer with synthetic data. No database method,
// email sender, model API or remote image is invoked.
const po = {
  id: 'fixture', poNumber: 'TEST-200', status: 'DRAFT', language: 'en',
  orderedAt: null, createdAt: new Date('2026-09-10T19:00:00Z'), expectedAt: null,
  forProduct: { name: 'Cleo Tee' }, contactLines: null,
  deliverTo: 'TEST MANUFACTURER\n123 Example St\nLos Angeles, CA 90001',
  paymentTerms: '50% on order, balance on delivery', notes: 'TEST DATA — NOT A REAL ORDER',
  vendor: { name: 'Test Fabric Supplier', legalName: 'TEST SUPPLIER LLC', contactName: 'Test Contact', address: '456 Example St\nLos Angeles, CA 90001' },
  lines: [{ id: 'line-1', component: null, productVariant: null, description: 'Fine rib fabric', qtyOrdered: 300, unit: 'yards', unitCostCents: 400 }],
} as unknown as PoForPdf
const defaults = { billToLines: 'TEST COMPANY\n789 Example St\nLos Angeles, CA 90001', confirmLine: 'Please confirm receipt.', confirmLineEs: 'Favor de confirmar la recepción.', contactLines: 'Test Contact · example@example.com' }

test('render real working, clean and Spanish PDFs with matching commercial values', async () => {
  const directory = '/tmp/studio-mouse-pdf-qa'
  await mkdir(directory, { recursive: true })
  const working = await renderPoSnapshot(po, defaults)
  const clean = await renderPoSnapshot(po, defaults, { clean: true })
  const spanish = await renderPoSnapshot({ ...po, language: 'es', notes: 'DATOS DE PRUEBA — NO ES UN PEDIDO REAL', paymentTerms: '50% al pedido, saldo contra entrega', lines: [{ ...po.lines[0], description: 'Tela de punto acanalado fino', unit: 'yardas' }] }, defaults, { clean: true })
  for (const [name, bytes] of Object.entries({ working, clean, spanish })) {
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    await writeFile(`${directory}/${name}.pdf`, bytes)
  }
  // Poppler is optional for contributors; the binary/header check runs everywhere.
  try { execFileSync('pdftotext', ['-v'], { stdio: 'pipe' }) } catch { return }
  const extract = (name: string) => execFileSync('pdftotext', [`${directory}/${name}.pdf`, '-'], { encoding: 'utf8' })
  assert.match(extract('working'), /DRAFT/)
  assert.doesNotMatch(extract('clean'), /DRAFT/)
  assert.doesNotMatch(extract('spanish'), /BORRADOR|DRAFT/)
  for (const name of ['working', 'clean', 'spanish']) {
    assert.match(extract(name), /1,200\.00/)
    assert.match(extract(name), /300/)
    assert.match(extract(name), /Cleo Tee/)
  }
  assert.match(extract('spanish'), /ORDEN DE COMPRA/)
  assert.match(extract('spanish'), /saldo contra entrega/)
})
