import ExcelJS from 'exceljs'

/**
 * Spreadsheets sent in chat, read as text (15 Nov 2026). Cleo sent an Excel
 * stylist line sheet to Mouse to work from; the chat took only PDFs and
 * pictures, so it never arrived and Mouse could do nothing with it. Claude
 * cannot read a workbook itself, so each sheet goes to it as plain rows,
 * while the original file is kept as sent, for keep_file to file.
 */

export { XLSX_TYPE, CSV_TYPE, isSheet, sheetTypeFor } from '@/lib/sheet-type'
import { CSV_TYPE } from '@/lib/sheet-type'

/** Most text handed to Mouse from one spreadsheet: a line sheet is a few thousand. */
export const SHEET_TEXT_LIMIT = 60_000

/** One cell as plain text: a formula's result, a date as ISO, rich text joined. Pure. */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('result' in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null)
    if ('richText' in v) return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('')
    if ('text' in v) return String((v as { text: unknown }).text)
    if ('hyperlink' in v) return String((v as { hyperlink: unknown }).hyperlink)
    return ''
  }
  return String(v)
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** Cut to the limit, saying so: a silent cut is how a note lost its last line once. Pure. */
function capped(text: string): string {
  if (text.length <= SHEET_TEXT_LIMIT) return text
  return `${text.slice(0, SHEET_TEXT_LIMIT)}\n[Cut here: the file is longer than ${SHEET_TEXT_LIMIT.toLocaleString('en-US')} characters. Ask for the part you need.]`
}

/** The spreadsheet as text: each sheet's name, then its rows as CSV. */
export async function sheetText(mediaType: string, base64: string): Promise<string> {
  const bytes = Buffer.from(base64, 'base64')
  if (mediaType === CSV_TYPE) return capped(bytes.toString('utf8'))
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(bytes as unknown as ArrayBuffer)
  const parts: string[] = []
  book.eachSheet((sheet) => {
    const rows: string[] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      for (let c = 1; c <= row.cellCount; c++) cells.push(csvCell(cellText(row.getCell(c).value).trim()))
      while (cells.length && !cells[cells.length - 1]) cells.pop()
      if (cells.length) rows.push(cells.join(','))
    })
    parts.push(`## Sheet: ${sheet.name}\n${rows.join('\n') || '(empty)'}`)
  })
  return capped(parts.join('\n\n') || '(no sheets)')
}
