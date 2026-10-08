import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { lineSheetWorkbook, priceCells, sheetRow } from '../lib/line-sheet-xlsx'
import type { LineSheetLine } from '../lib/line-sheet'

const line = (o: Partial<LineSheetLine>): LineSheetLine => ({
  id: 'r1', position: 0, productId: 'p1', colorway: null, item: 'Sardine', style: 'AC104', colorLabel: 'Naked', description: 'A small bag.',
  ownDescription: '', wholesaleCents: 4000, wholesaleMaxCents: null, retail: '$98', msrp: null, sizing: 'One size',
  minOrder: '6 units', availability: 'Ships now', photo: null, photoData: null, onHand: 3, hidden: false, ...o,
})

test('prices are read back to cents, a range to both ends, typed text to nothing', () => {
  assert.deepEqual(priceCells('$98'), [9800, null])
  assert.deepEqual(priceCells('$1,098.50'), [109850, null])
  assert.deepEqual(priceCells('$98 – $120'), [9800, 12000])
  assert.equal(priceCells('ask us'), null)
  assert.equal(priceCells(null), null)
})

test('a row carries prices as numbers in dollars, a range in the "up to" column', () => {
  assert.deepEqual(sheetRow(line({ wholesaleCents: 4000, wholesaleMaxCents: 4400, retail: '$98 – $110' })).slice(4, 8), [40, 44, 98, 110])
  assert.deepEqual(sheetRow(line({ retail: 'MSRP on request' })).slice(6, 8), ['MSRP on request', null])
})

test('the workbook opens in Excel with the rows under the header, prices as numbers, and nothing for the team only', async () => {
  const meta = { title: 'Fall 2026', tagline: 't', materials: 'm', press: 'Vogue\n\nThe Cut', contact: 'studio@cleocamp.com', footnote: 'f' }
  const buf = await lineSheetWorkbook(meta, [line({}), line({ id: 'r2', item: 'Bean Bag', wholesaleCents: 18400 })], new Date('2026-10-05T18:00:00Z'))
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(new Uint8Array(buf).buffer)
  const ws = wb.getWorksheet('Line Sheet')!
  assert.equal(ws.getRow(6).getCell(1).value, 'Item')
  assert.equal(ws.getRow(7).getCell(1).value, 'Sardine')
  assert.equal(ws.getRow(6).getCell(2).value, 'Style')
  assert.equal(ws.getRow(7).getCell(2).value, 'AC104')
  assert.equal(ws.getRow(8).getCell(5).value, 184)
  assert.equal(typeof ws.getRow(7).getCell(5).value, 'number')
  assert.match(String(ws.getRow(5).getCell(1).value), /October 5, 2026/)
  const all = JSON.stringify(ws.getSheetValues())
  assert.ok(!all.includes('"onHand"') && !/\b3 on hand\b/.test(all)) // stock never goes to a store
  assert.ok(all.includes('The Cut'))
  assert.ok(!/commission/i.test(all)) // never on a sheet stores see (6 Oct 2026)
})

test('the terms (MOQ note, shipping fees) sit under the table, before press', async () => {
  const meta = { title: 'T', tagline: 't', materials: 'm', press: 'Vogue', contact: 'studio@cleocamp.com', footnote: '* Variants count toward MOQs.\nShipping: $25 flat per order.' }
  const buf = await lineSheetWorkbook(meta, [line({})], new Date('2026-10-06T18:00:00Z'))
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(new Uint8Array(buf).buffer)
  const first = (s: string) => { let at = -1; wb.getWorksheet('Line Sheet')!.eachRow((r, n) => { if (at < 0 && String(r.getCell(1).value ?? '').startsWith(s)) at = n }); return at }
  assert.ok(first('Shipping: $25') > first('Sardine'))
  assert.ok(first('Shipping: $25') < first('Press & Collaborations'))
  assert.ok(first('* Variants') < first('Press & Collaborations'))
})
