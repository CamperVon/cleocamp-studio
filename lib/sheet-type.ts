/** Spreadsheet types the chat accepts. No imports, so the chat page can use it in the browser. Pure. */

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_TYPE = 'text/csv'

/** Is this a spreadsheet the chat can read? Pure. */
export const isSheet = (mediaType: string) => mediaType === XLSX_TYPE || mediaType === CSV_TYPE

/**
 * The media type for a file the browser gave none, or a vague one, from its
 * name: some phones send a .csv as "" or "application/vnd.ms-excel". Pure.
 */
export function sheetTypeFor(filename: string, mediaType: string): string {
  if (/\.xlsx$/i.test(filename)) return XLSX_TYPE
  if (/\.csv$/i.test(filename)) return CSV_TYPE
  return mediaType
}

