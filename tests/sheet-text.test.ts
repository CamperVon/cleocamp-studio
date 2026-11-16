import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { sheetText, sheetTypeFor, isSheet, XLSX_TYPE, CSV_TYPE } from '../lib/sheet-text'
import { fileProblem } from '../lib/files'

// 15 Nov 2026: Cleo's stylist line sheet in Excel could not be sent to Mouse.

test('an Excel line sheet reads out sheet by sheet, as rows', async () => {
  const book = new ExcelJS.Workbook()
  const s = book.addWorksheet('Stylists')
  s.addRow(['Item', 'Colour', 'Note'])
  s.addRow(['Cleo Tee', 'Shell', 'Larger photo, "no" price'])
  s.addRow(['5to7 Skirt', 'Pink', 42])
  book.addWorksheet('Blank')
  const base64 = Buffer.from(await book.xlsx.writeBuffer()).toString('base64')
  const text = await sheetText(XLSX_TYPE, base64)
  assert.match(text, /## Sheet: Stylists\nItem,Colour,Note\nCleo Tee,Shell,"Larger photo, ""no"" price"\n5to7 Skirt,Pink,42/)
  assert.match(text, /## Sheet: Blank\n\(empty\)/)
})

test('a CSV passes through as it is', async () => {
  assert.equal(await sheetText(CSV_TYPE, Buffer.from('a,b\n1,2').toString('base64')), 'a,b\n1,2')
})

test('a spreadsheet is known by its name when the phone gives a vague type', () => {
  assert.equal(sheetTypeFor('Stylist sheet.xlsx', ''), XLSX_TYPE)
  assert.equal(sheetTypeFor('list.CSV', 'application/vnd.ms-excel'), CSV_TYPE)
  assert.equal(sheetTypeFor('photo.jpg', 'image/jpeg'), 'image/jpeg')
  assert.equal(isSheet(XLSX_TYPE), true)
  assert.equal(isSheet('application/pdf'), false)
})

test('a spreadsheet can be kept in Files', () => {
  assert.equal(fileProblem({ mediaType: XLSX_TYPE, sizeBytes: 1000, title: 'Stylist line sheet' }), null)
  assert.equal(fileProblem({ mediaType: CSV_TYPE, sizeBytes: 10, title: 'x' }), null)
})
