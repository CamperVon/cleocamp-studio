import ExcelJS from 'exceljs'
import { loadLineSheet, onThePdf, type LineSheetLine, type LineSheetMetaText } from '@/lib/line-sheet'

/**
 * The wholesale line sheet as an Excel workbook, beside the PDF (Brandon,
 * 5 Oct 2026). Same rows as the PDF, in the same order, held back for the
 * same reasons (onThePdf), so the two never disagree. Prices go in as
 * numbers, not text, so a store can sort, filter and multiply them; a price
 * that is a range ("$40 – $44") fills a second "up to" column. No photos:
 * stores that ask for Excel are usually loading it into their own system.
 */

/** "$98" → [9800, null]; "$98 – $120" → [9800, 12000]; anything else (a typed MSRP) → null. Pure. */
export function priceCells(text: string | null): [number, number | null] | null {
  const m = /^\$([\d,]+(?:\.\d+)?)(?:\s*–\s*\$([\d,]+(?:\.\d+)?))?$/.exec((text ?? '').trim())
  if (!m) return null
  const cents = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100)
  return [cents(m[1]), m[2] ? cents(m[2]) : null]
}

const COLUMNS: Array<{ header: string; width: number; money?: boolean }> = [
  { header: 'Item', width: 22 },
  { header: 'Color / Variant', width: 20 },
  { header: 'Description', width: 60 },
  { header: 'Wholesale', width: 12, money: true },
  { header: 'Wholesale (up to)', width: 15, money: true },
  { header: 'Suggested Retail', width: 15, money: true },
  { header: 'Suggested Retail (up to)', width: 20, money: true },
  { header: 'Sizing', width: 22 },
  { header: 'Min. Order', width: 22 },
  { header: 'Commission', width: 14 },
  { header: 'Availability', width: 22 },
]

/** One row's cells, in COLUMNS order. Money in dollars. Pure. */
export function sheetRow(l: LineSheetLine): Array<string | number | null> {
  const usd = (c: number | null) => (c == null ? null : c / 100)
  const retail = priceCells(l.retail)
  return [
    l.item,
    l.colorLabel,
    l.description,
    usd(l.wholesaleCents),
    usd(l.wholesaleMaxCents),
    retail ? usd(retail[0]) : l.retail, // a typed MSRP stays as written
    retail ? usd(retail[1]) : null,
    l.sizing || null,
    l.minOrder || null,
    l.commission || null,
    l.availability || null,
  ]
}

export async function lineSheetWorkbook(meta: LineSheetMetaText, lines: LineSheetLine[], asOf: Date): Promise<Buffer> {
  const date = asOf.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Cleo Camp'
  wb.created = asOf
  const ws = wb.addWorksheet('Line Sheet', { views: [{ state: 'frozen', ySplit: 6 }] })
  ws.columns = COLUMNS.map((c) => ({ width: c.width }))

  ws.addRow(['Cleo Camp']).font = { bold: true, size: 16 }
  ws.addRow([meta.title]).font = { bold: true, italic: true, size: 12 }
  ws.addRow([meta.tagline])
  ws.addRow([meta.materials]).font = { color: { argb: 'FF6A736F' } }
  ws.addRow([`Wholesale prices as of ${date}, in US dollars`]).font = { color: { argb: 'FF6A736F' }, italic: true }

  const head = ws.addRow(COLUMNS.map((c) => c.header))
  head.font = { bold: true }
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0EC' } }
    cell.border = { bottom: { style: 'thin' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })

  for (const l of lines) {
    const row = ws.addRow(sheetRow(l))
    row.alignment = { vertical: 'top', wrapText: true }
    COLUMNS.forEach((c, i) => {
      if (c.money) row.getCell(i + 1).numFmt = '"$"#,##0.00'
    })
    row.getCell(4).font = { bold: true }
  }
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: COLUMNS.length } }

  ws.addRow([])
  ws.addRow(['Press & Collaborations']).font = { bold: true, italic: true }
  for (const para of meta.press.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) ws.addRow([para])
  ws.addRow([meta.contact])
  ws.addRow([meta.footnote]).font = { color: { argb: 'FF6A736F' } }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** The workbook, drawn now with today's prices. Null when nothing is ready to show a store. */
export async function renderLineSheetXlsx(asOf = new Date()): Promise<Buffer | null> {
  const { meta, lines: all } = await loadLineSheet()
  const lines = all.filter(onThePdf)
  if (!meta || !lines.length) return null
  return lineSheetWorkbook(meta, lines, asOf)
}
